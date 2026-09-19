import redisClient from '../config/redis.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import { emitToLiveRoom } from '../utils/socket-room.util.js';
import logger from '../utils/logger.util.js';

const DEDUPE_TTL_SECONDS = 15;
const QUEUE_MAX_LENGTH = 100;
const DISPATCH_INTERVAL_MS = 350; // Dispatch every 350ms
const MAX_BATCH_SIZE = 5; // Max 5 announcements per tick
const IDLE_TICKS_BEFORE_STOP = 10; // Stop interval after ~3.5s of empty queue

class LiveAnnouncementService {
  constructor() {
    /**
     * Map<roomId, { timer: NodeJS.Timeout, idleCount: number }>
     */
    this.activeDispatchers = new Map();
  }

  /**
   * Asynchronously enqueue a new user join event into the Redis buffer for a room.
   * Completely non-blocking and safe against high concurrency.
   *
   * @param {Object} io - Socket.io instance
   * @param {string} roomId - Live room ID
   * @param {Object} user - User metadata { userId, name, avatar, userType }
   */
  enqueueJoinAnnouncement(io, roomId, user) {
    // Non-blocking fire-and-forget
    setImmediate(async () => {
      try {
        if (!roomId || !user?.userId) return;

        const userIdStr = String(user.userId);
        const dedupeKey = `live:announcement:seen:${roomId}:${userIdStr}`;

        // 1. Deduplication using Redis NX key
        const isNew = await redisClient.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');
        if (!isNew && redisClient.isRedisAvailable) {
          // User already announced in this room within DEDUPE_TTL_SECONDS
          return;
        }

        const queueKey = `live:announcement:queue:${roomId}`;
        const announcement = {
          id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          userId: userIdStr,
          name: String(user.name || 'User').trim() || 'User',
          avatar: user.avatar || null,
          userType: user.userType || 'CUSTOMER',
          timestamp: Date.now(),
        };

        // 2. Buffer into Redis Queue
        await redisClient.rpush(queueKey, JSON.stringify(announcement));
        await redisClient.expire(queueKey, 3600); // 1-hour safety TTL

        // 3. Trim to prevent memory runaway during sudden spikes
        const len = await redisClient.llen(queueKey);
        if (len && len > QUEUE_MAX_LENGTH) {
          await redisClient.ltrim(queueKey, -QUEUE_MAX_LENGTH, -1);
        }

        // 4. Ensure rate-controlled dispatcher is active for this room
        this._ensureDispatcher(io, roomId);
      } catch (err) {
        logger.error(`[LiveAnnouncement] Error enqueueing join: ${err.message}`);
      }
    });
  }

  /**
   * Start or resume the dispatch interval ticker for a given room.
   */
  _ensureDispatcher(io, roomId) {
    if (this.activeDispatchers.has(roomId)) {
      // Reset idle count since we have new traffic
      const state = this.activeDispatchers.get(roomId);
      state.idleCount = 0;
      return;
    }

    const timer = setInterval(() => {
      this._dispatchBatch(io, roomId);
    }, DISPATCH_INTERVAL_MS);

    this.activeDispatchers.set(roomId, { timer, idleCount: 0 });
  }

  /**
   * Pop a batch of announcements from the Redis queue and broadcast to room participants.
   */
  async _dispatchBatch(io, roomId) {
    try {
      const queueKey = `live:announcement:queue:${roomId}`;
      const state = this.activeDispatchers.get(roomId);

      const items = [];
      for (let i = 0; i < MAX_BATCH_SIZE; i++) {
        const raw = await redisClient.lpop(queueKey);
        if (!raw) break;
        try {
          items.push(JSON.parse(raw));
        } catch {
          // ignore corrupted json
        }
      }

      if (items.length > 0) {
        if (state) state.idleCount = 0;

        // Broadcast to all participants in the live room
        emitToLiveRoom(io, roomId, SERVER_EVENTS.LIVE_USER_ANNOUNCEMENT, {
          roomId,
          announcements: items,
        });
      } else {
        // Queue is empty for this tick
        if (state) {
          state.idleCount += 1;
          if (state.idleCount >= IDLE_TICKS_BEFORE_STOP) {
            // Stop ticker when room has been idle to save event loop ticks
            clearInterval(state.timer);
            this.activeDispatchers.delete(roomId);
          }
        }
      }
    } catch (err) {
      logger.error(`[LiveAnnouncement] Dispatch error for room ${roomId}: ${err.message}`);
    }
  }

  /**
   * Clean up Redis keys and dispatcher timer when a live room ends.
   *
   * @param {string} roomId
   */
  cleanupRoom(roomId) {
    if (!roomId) return;

    // Clear active dispatcher ticker
    if (this.activeDispatchers.has(roomId)) {
      const state = this.activeDispatchers.get(roomId);
      clearInterval(state.timer);
      this.activeDispatchers.delete(roomId);
    }

    // Delete Redis queue
    setImmediate(async () => {
      try {
        const queueKey = `live:announcement:queue:${roomId}`;
        await redisClient.del(queueKey);
      } catch (err) {
        logger.error(`[LiveAnnouncement] Cleanup error for room ${roomId}: ${err.message}`);
      }
    });
  }
}

export default new LiveAnnouncementService();
