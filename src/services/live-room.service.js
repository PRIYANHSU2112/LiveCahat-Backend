import BaseService from './base.service.js';
import liveRoomRepository from '../repositories/live-room.repository.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { buildLiveChannelName } from '../utils/agora.util.js';

// Pending host-disconnect timers (in-memory, per-instance).
// Key: hostId, Value: NodeJS.Timeout
const disconnectTimers = new Map();

class LiveRoomService extends BaseService {
  constructor() {
    super(liveRoomRepository);
  }

  // ─── Room lifecycle ─────────────────────────────────────────────────────────

  async createRoom(hostId, { title, mode }) {
    // Guard: host can only have one live room at a time
    const existing = await this.getActiveRoomByHost(hostId);
    if (existing) return existing;

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
      ]);
    }

    return room;
  }

  async endRoom(roomId, hostId) {
    let viewerCount = 0;
    let likeCount = 0;

    if (redisClient.isRedisAvailable) {

      const [lc, viewers] = await Promise.all([
        redisClient.get(KEYS.liveRoomLikeCount(roomId)),
        redisClient.scard(KEYS.liveRoomViewers(roomId))
      ]);

      likeCount = parseInt(lc || '0', 10);
      viewerCount = parseInt(viewers || '0', 10);

      await Promise.all([
        redisClient.del(KEYS.liveRoomHost(hostId)),
        redisClient.del(KEYS.liveRoomViewers(roomId)),
        redisClient.del(KEYS.liveRoomLikeCount(roomId)),
        redisClient.del(KEYS.liveRoomComments(roomId)),
        redisClient.del(KEYS.liveRoomDisconnectGrace(hostId))
      ]);
    }

    this.clearDisconnectTimer(hostId);

    return this.updateItem(roomId, {
      status: 'ended',
      endedAt: new Date(),
      viewerCount,
      likeCount,
    });
  }

  // ─── Viewer tracking ────────────────────────────────────────────────────────

  async addViewer(roomId, userId) {
    if (!redisClient.isRedisAvailable) return 0;
    // sadd and the reverse-lookup set are independent — fire both, then read count
    await Promise.all([
      redisClient.sadd(KEYS.liveRoomViewers(roomId), userId),
      redisClient.set(KEYS.liveRoomViewer(userId), roomId),
    ]);
    return redisClient.scard(KEYS.liveRoomViewers(roomId));
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

  async addComment(roomId, userId, userName, text) {
    const comment = { userId, userName, text, timestamp: new Date().toISOString() };

    if (redisClient.isRedisAvailable) {
      const key = KEYS.liveRoomComments(roomId);
      // Pipeline: both commands sent in one RTT, executed in order on Redis side
      await redisClient.pipeline().lpush(key, JSON.stringify(comment)).ltrim(key, 0, 49).exec();
    }

    return comment;
  }

  async getRecentComments(roomId) {
    if (!redisClient.isRedisAvailable) return [];
    const raw = await redisClient.lrange(KEYS.liveRoomComments(roomId), 0, 49);
    return raw.map((c) => JSON.parse(c)).reverse(); // oldest → newest
  }

  // ─── Likes ──────────────────────────────────────────────────────────────────

  async incrementLike(roomId) {
    if (!redisClient.isRedisAvailable) return 0;
    return redisClient.incr(KEYS.liveRoomLikeCount(roomId));
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
      if (roomId) return this.getItemById(roomId);
    }
    return liveRoomRepository.findActiveByHostId(hostId);
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
