import BaseService from './base.service.js';
import liveRoomRepository from '../repositories/live-room.repository.js';
import liveCommentRepository from '../repositories/live-comment.repository.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { buildLiveChannelName } from '../utils/agora.util.js';
import logger from '../utils/logger.util.js';

// Pending host-disconnect timers (in-memory, per-instance).
// Key: hostId, Value: NodeJS.Timeout
const disconnectTimers = new Map();

// Batch Flush Thresholds
const BATCH_FLUSH_COUNT = 1000;
const BATCH_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class LiveRoomService extends BaseService {
  constructor() {
    super(liveRoomRepository);
    this._startBackgroundFlushWorker();
  }

  /**
   * Background worker to flush all active live rooms every 5 minutes.
   */
  _startBackgroundFlushWorker() {
    this._flushInterval = setInterval(async () => {
      try {
        await this.flushAllActiveRooms();
      } catch (err) {
        logger.error(`[LiveRoomService] Background flush worker error: ${err.message}`);
      }
    }, BATCH_FLUSH_INTERVAL_MS);

    // Unref interval so it won't block process exit
    if (this._flushInterval.unref) {
      this._flushInterval.unref();
    }
  }

  // ─── Room lifecycle ─────────────────────────────────────────────────────────

  async createRoom(hostId, { title, mode }) {
    // Guard: host can only have one live room at a time
    const existing = await this.getActiveRoomByHost(hostId);
    if (existing) {
      // Reusing an old AUDIO room would make new VIDEO lives voice-only
      if (existing.mode !== mode) {
        await this.endRoom(existing._id.toString(), hostId);
      } else {
        return existing;
      }
    }

    const room = await this.createItem({
      hostId,
      channelName: buildLiveChannelName(hostId + '_' + Date.now()),
      title: title || '',
      mode,
      status: 'live',
      startedAt: new Date(),
    });

    const roomId = room._id.toString();

    if (redisClient.isRedisAvailable) {
      await Promise.all([
        redisClient.set(KEYS.liveRoomHost(hostId), roomId),
        redisClient.set(KEYS.liveRoomLikeCount(roomId), '0'),
        redisClient.set(KEYS.liveRoomPeakViewers(roomId), '0'),
        redisClient.set(KEYS.liveRoomTotalComments(roomId), '0'),
      ]);
    }

    return room;
  }

  async endRoom(roomId, hostId) {
    let viewerCount = 0;
    let peakViewers = 0;
    let likeCount = 0;

    // 1. Immediately flush all pending buffered comments to MongoDB
    await this.flushRoomComments(roomId);

    if (redisClient.isRedisAvailable) {
      const [lc, viewers, peak] = await Promise.all([
        redisClient.get(KEYS.liveRoomLikeCount(roomId)),
        redisClient.scard(KEYS.liveRoomViewers(roomId)),
        redisClient.get(KEYS.liveRoomPeakViewers(roomId)),
      ]);

      likeCount = parseInt(lc || '0', 10);
      viewerCount = parseInt(viewers || '0', 10);
      peakViewers = parseInt(peak || '0', 10);

      await Promise.all([
        redisClient.del(KEYS.liveRoomHost(hostId)),
        redisClient.del(KEYS.liveRoomViewers(roomId)),
        redisClient.del(KEYS.liveRoomLikeCount(roomId)),
        redisClient.del(KEYS.liveRoomLikers(roomId)),
        redisClient.del(KEYS.liveRoomComments(roomId)),
        redisClient.del(KEYS.liveRoomCommentBuffer(roomId)),
        redisClient.del(KEYS.liveRoomTotalComments(roomId)),
        redisClient.del(KEYS.liveRoomPeakViewers(roomId)),
        redisClient.del(KEYS.liveRoomDisconnectGrace(hostId)),
      ]);
    }

    this.clearDisconnectTimer(hostId);

    return this.updateItem(roomId, {
      status: 'ended',
      endedAt: new Date(),
      viewerCount: Math.max(viewerCount, peakViewers),
      likeCount,
    });
  }

  // ─── Viewer tracking ────────────────────────────────────────────────────────

  async addViewer(roomId, userId) {
    if (!redisClient.isRedisAvailable) return 0;
    
    await Promise.all([
      redisClient.sadd(KEYS.liveRoomViewers(roomId), userId),
      redisClient.set(KEYS.liveRoomViewer(userId), roomId),
    ]);

    const count = await redisClient.scard(KEYS.liveRoomViewers(roomId));

    // Update peak viewers if current count is higher
    const peakKey = KEYS.liveRoomPeakViewers(roomId);
    const currentPeak = parseInt((await redisClient.get(peakKey)) || '0', 10);
    if (count > currentPeak) {
      await redisClient.set(peakKey, count.toString());
    }

    return count;
  }

  async removeViewer(roomId, userId) {
    if (!redisClient.isRedisAvailable) return 0;
    await Promise.all([
      redisClient.srem(KEYS.liveRoomViewers(roomId), userId),
      redisClient.del(KEYS.liveRoomViewer(userId)),
    ]);
    return Math.max(0, await redisClient.scard(KEYS.liveRoomViewers(roomId)));
  }

  async getViewerRoom(userId) {
    if (!redisClient.isRedisAvailable) return null;
    return redisClient.get(KEYS.liveRoomViewer(userId));
  }

  async getViewerCount(roomId) {
    if (!redisClient.isRedisAvailable) return 0;
    return redisClient.scard(KEYS.liveRoomViewers(roomId));
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

  async addComment(roomId, userId, userName, text, userImage = null, isHost = false) {
    const comment = {
      roomId,
      userId,
      userName: userName || 'User',
      userImage: userImage || null,
      text,
      isHost: !!isHost,
      timestamp: new Date().toISOString(),
    };

    if (redisClient.isRedisAvailable) {
      const recentKey = KEYS.liveRoomComments(roomId);
      const bufferKey = KEYS.liveRoomCommentBuffer(roomId);
      const totalKey = KEYS.liveRoomTotalComments(roomId);
      const serialized = JSON.stringify(comment);

      // Pipeline: 1) add to recent 50 list, 2) add to persistence buffer, 3) incr total
      const results = await redisClient
        .pipeline()
        .lpush(recentKey, serialized)
        .ltrim(recentKey, 0, 49)
        .rpush(bufferKey, serialized)
        .incr(totalKey)
        .llen(bufferKey)
        .exec();

      // Check buffer size (results[4][1] is llen output)
      const bufferLen = results && results[4] ? results[4][1] : 0;
      if (bufferLen >= BATCH_FLUSH_COUNT) {
        // Trigger non-blocking async flush
        this.flushRoomComments(roomId).catch((err) =>
          logger.error(`[LiveRoomService] Auto batch flush error: ${err.message}`)
        );
      }
    } else {
      // Fallback: direct MongoDB insert if Redis unavailable
      liveCommentRepository
        .createItem({
          roomId,
          userId,
          userName: comment.userName,
          userImage: comment.userImage,
          text: comment.text,
          isHost: comment.isHost,
          createdAt: new Date(),
        })
        .catch((err) => logger.error(`[LiveRoomService] DB comment fallback error: ${err.message}`));
    }

    return comment;
  }

  async getRecentComments(roomId) {
    if (redisClient.isRedisAvailable) {
      const raw = await redisClient.lrange(KEYS.liveRoomComments(roomId), 0, 49);
      if (raw && raw.length > 0) {
        return raw.map((c) => JSON.parse(c)).reverse(); // oldest → newest
      }
    }

    // Fallback: fetch from MongoDB if Redis empty
    const dbComments = await liveCommentRepository.findByRoomId(roomId, 50, 0);
    return dbComments
      .map((c) => ({
        userId: c.userId?.toString() || c.userId,
        userName: c.userName,
        userImage: c.userImage,
        text: c.text,
        isHost: c.isHost,
        timestamp: c.createdAt ? c.createdAt.toISOString() : new Date().toISOString(),
      }))
      .reverse();
  }

  /**
   * Flushes batched comments for a specific live room from Redis to MongoDB.
   */
  async flushRoomComments(roomId) {
    if (!redisClient.isRedisAvailable) return 0;
    const bufferKey = KEYS.liveRoomCommentBuffer(roomId);

    try {
      const rawItems = await redisClient.lrange(bufferKey, 0, -1);
      if (!rawItems || !rawItems.length) return 0;

      // Trim flushed elements from Redis list
      await redisClient.ltrim(bufferKey, rawItems.length, -1);

      const docs = rawItems.map((item) => {
        const c = JSON.parse(item);
        return {
          roomId: c.roomId,
          userId: c.userId,
          userName: c.userName || 'User',
          userImage: c.userImage || null,
          text: c.text,
          isHost: !!c.isHost,
          createdAt: c.timestamp ? new Date(c.timestamp) : new Date(),
        };
      });

      await liveCommentRepository.bulkInsert(docs);
      logger.info(`[LiveRoomService] Flushed ${docs.length} batched comments for room ${roomId} to MongoDB.`);
      return docs.length;
    } catch (err) {
      logger.error(`[LiveRoomService] Failed to flush comments for room ${roomId}: ${err.message}`);
      return 0;
    }
  }

  /**
   * Periodic bulk flush for all currently active rooms.
   */
  async flushAllActiveRooms() {
    const activeRooms = await liveRoomRepository.findLiveRooms(0, 500);
    if (!activeRooms || !activeRooms.length) return;

    for (const room of activeRooms) {
      const roomId = room._id.toString();
      await this.flushRoomComments(roomId);

      // Also checkpoint current likeCount to MongoDB
      if (redisClient.isRedisAvailable) {
        const lc = await redisClient.get(KEYS.liveRoomLikeCount(roomId));
        if (lc !== null) {
          const likeCount = parseInt(lc || '0', 10);
          await liveRoomRepository.updateById(roomId, { likeCount });
        }
      }
    }
  }

  // ─── Likes (Toggle: 1 like per user) ────────────────────────────────────────

  async toggleLike(roomId, userId) {
    if (!redisClient.isRedisAvailable) return { liked: true, likeCount: 1 };
    const likersKey = KEYS.liveRoomLikers(roomId);
    const likeCountKey = KEYS.liveRoomLikeCount(roomId);

    // Check if user has already liked
    const isMember = await redisClient.sismember(likersKey, userId);

    let liked = false;
    let likeCount = 0;

    if (isMember === 1) {
      // User already liked -> UNLIKE (remove from set & decrement count)
      await redisClient.srem(likersKey, userId);
      const newCount = await redisClient.decr(likeCountKey);
      likeCount = Math.max(0, newCount);
      if (newCount < 0) {
        await redisClient.set(likeCountKey, '0');
      }
      liked = false;
    } else {
      // User has not liked -> LIKE (add to set & increment count)
      await redisClient.sadd(likersKey, userId);
      likeCount = await redisClient.incr(likeCountKey);
      liked = true;
    }

    return { liked, likeCount };
  }

  async hasUserLiked(roomId, userId) {
    if (!redisClient.isRedisAvailable) return false;
    const isMember = await redisClient.sismember(KEYS.liveRoomLikers(roomId), userId);
    return isMember === 1;
  }

  async getLikeCount(roomId) {
    if (!redisClient.isRedisAvailable) return 0;
    const count = await redisClient.get(KEYS.liveRoomLikeCount(roomId));
    return parseInt(count || '0', 10);
  }

  // ─── Host lookup ────────────────────────────────────────────────────────────

  async getActiveRoomByHost(hostId) {
    if (redisClient.isRedisAvailable) {
      const roomId = await redisClient.get(KEYS.liveRoomHost(hostId));
      if (roomId) {
        const room = await this.getItemById(roomId);
        if (room && room.status === 'live') {
          return room;
        }
        // Stale Redis key cleanup
        await redisClient.del(KEYS.liveRoomHost(hostId));
      }
    }
    return liveRoomRepository.findActiveByHostId(hostId);
  }

  async getLiveRoomWithHost(roomId) {
    return liveRoomRepository.findById(roomId, '', {
      path: 'hostId',
      select: 'firstName lastName profileImage',
    });
  }

  // ─── Active rooms list ──────────────────────────────────────────────────────

  async getActiveRooms(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    return liveRoomRepository.findLiveRooms(skip, limit);
  }

  // ─── Host disconnect grace period ───────────────────────────────────────────

  async setDisconnectGrace(hostId, roomId, onExpire) {
    if (redisClient.isRedisAvailable) {
      await redisClient.set(KEYS.liveRoomDisconnectGrace(hostId), roomId, 'EX', 30);
    }

    // Clear any existing timer before setting a new one
    this.clearDisconnectTimer(hostId);

    const timer = setTimeout(async () => {
      disconnectTimers.delete(hostId);
      // Only auto-end if grace key is still present (host hasn't reconnected)
      const grace = redisClient.isRedisAvailable
        ? await redisClient.get(KEYS.liveRoomDisconnectGrace(hostId))
        : roomId;
      if (grace) {
        await onExpire(roomId);
      }
    }, 30_000);

    disconnectTimers.set(hostId, timer);
  }

  async clearDisconnectGrace(hostId) {
    if (redisClient.isRedisAvailable) {
      await redisClient.del(KEYS.liveRoomDisconnectGrace(hostId));
    }
    this.clearDisconnectTimer(hostId);
  }

  clearDisconnectTimer(hostId) {
    const timer = disconnectTimers.get(hostId);
    if (timer) {
      clearTimeout(timer);
      disconnectTimers.delete(hostId);
    }
  }
}

export default new LiveRoomService();
