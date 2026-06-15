import redisClient from '../config/redis.js';
import User from '../modules/user.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import { getSocketIo } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';
import { bumpCacheVersion, deleteCache } from '../utils/redis.util.js';

class PresenceService {
  /**
   * Set user status to ONLINE when socket connects.
   */
  async goOnline(userId, socketId, userType) {
    try {
      const connKey = KEYS.presenceConnections(userId);
      const statusKey = KEYS.presenceStatus(userId);

      // Handle redis connection issues gracefully
      if (redisClient.isRedisAvailable) {
        await redisClient.sadd(connKey, socketId);
      }

      // Check current presence status in Redis
      let currentStatus = redisClient.isRedisAvailable ? await redisClient.get(statusKey) : null;

      if (!currentStatus) {
        // Transition from offline to online
        await User.findByIdAndUpdate(userId, { isOnline: true });

        if (userType === 'LISTENER') {
          if (redisClient.isRedisAvailable) {
            await redisClient.set(statusKey, 'ONLINE');
          }
          await ListenerProfile.findOneAndUpdate({ userId }, { availability: 'ONLINE' });
          await deleteCache(`listener:${userId}`);
          await bumpCacheVersion('listeners');
          this.broadcastStatusChange(userId, 'ONLINE');
        } else {
          if (redisClient.isRedisAvailable) {
            await redisClient.set(statusKey, 'ONLINE');
          }
        }
      } else {
        // Already online. If it's a listener and currently BUSY in DB, keep Redis BUSY.
        if (userType === 'LISTENER') {
          const profile = await ListenerProfile.findOne({ userId }).select('availability');
          if (profile && profile.availability === 'BUSY') {
            if (redisClient.isRedisAvailable) {
              await redisClient.set(statusKey, 'BUSY');
            }
          } else {
            if (redisClient.isRedisAvailable) {
              await redisClient.set(statusKey, 'ONLINE');
            }
            await ListenerProfile.findOneAndUpdate({ userId }, { availability: 'ONLINE' });
            await deleteCache(`listener:${userId}`);
            await bumpCacheVersion('listeners');
            this.broadcastStatusChange(userId, 'ONLINE');
          }
        }
      }
    } catch (err) {
      logger.error(`[Presence goOnline Error] Failed for user ${userId}: ${err.message}`);
    }
  }

  /**
   * Set user offline when socket disconnects.
   */
  async goOffline(userId, socketId, userType) {
    try {
      const connKey = KEYS.presenceConnections(userId);
      const statusKey = KEYS.presenceStatus(userId);

      let activeConnections = 0;

      if (redisClient.isRedisAvailable) {
        await redisClient.srem(connKey, socketId);
        activeConnections = await redisClient.scard(connKey);
      }

      if (activeConnections === 0) {
        // Fully mark offline immediately
        await User.findByIdAndUpdate(userId, { isOnline: false });

        if (redisClient.isRedisAvailable) {
          await redisClient.del(statusKey);
          await redisClient.del(connKey);
        }

        if (userType === 'LISTENER') {
          await ListenerProfile.findOneAndUpdate({ userId }, { availability: 'OFFLINE' });
          await deleteCache(`listener:${userId}`);
          await bumpCacheVersion('listeners');
          this.broadcastStatusChange(userId, 'OFFLINE');
        }
      }
    } catch (err) {
      logger.error(`[Presence goOffline Error] Failed for user ${userId}: ${err.message}`);
    }
  }

  /**
   * Set listener to BUSY.
   */
  async setBusy(userId) {
    try {
      const statusKey = KEYS.presenceStatus(userId);
      if (redisClient.isRedisAvailable) {
        await redisClient.set(statusKey, 'BUSY');
      }
      await ListenerProfile.findOneAndUpdate({ userId }, { availability: 'BUSY' });
      await deleteCache(`listener:${userId}`);
      await bumpCacheVersion('listeners');
      this.broadcastStatusChange(userId, 'BUSY');
    } catch (err) {
      logger.error(`[Presence setBusy Error] Failed for listener ${userId}: ${err.message}`);
    }
  }

  /**
   * Set listener back to ONLINE.
   */
  async setAvailable(userId) {
    try {
      const statusKey = KEYS.presenceStatus(userId);
      if (redisClient.isRedisAvailable) {
        await redisClient.set(statusKey, 'ONLINE');
      }
      await ListenerProfile.findOneAndUpdate({ userId }, { availability: 'ONLINE' });
      await deleteCache(`listener:${userId}`);
      await bumpCacheVersion('listeners');
      this.broadcastStatusChange(userId, 'ONLINE');
    } catch (err) {
      logger.error(`[Presence setAvailable Error] Failed for listener ${userId}: ${err.message}`);
    }
  }

  /**
   * Set listener to OFFLINE manually.
   */
  async setOffline(userId) {
    try {
      const statusKey = KEYS.presenceStatus(userId);
      if (redisClient.isRedisAvailable) {
        await redisClient.set(statusKey, 'OFFLINE');
      }
      await ListenerProfile.findOneAndUpdate({ userId }, { availability: 'OFFLINE' });
      await deleteCache(`listener:${userId}`);
      await bumpCacheVersion('listeners');
      this.broadcastStatusChange(userId, 'OFFLINE');
    } catch (err) {
      logger.error(`[Presence setOffline Error] Failed for listener ${userId}: ${err.message}`);
    }
  }

  /**
   * Fetch current presence status.
   */
  async getStatus(userId) {
    try {
      const statusKey = KEYS.presenceStatus(userId);
      const status = redisClient.isRedisAvailable ? await redisClient.get(statusKey) : null;
      return status || 'OFFLINE';
    } catch (err) {
      logger.error(`[Presence getStatus Error] Failed for user ${userId}: ${err.message}`);
      return 'OFFLINE';
    }
  }

  /**
   * Broadcast presence status changes to all clients.
   */
  broadcastStatusChange(listenerId, status) {
    const io = getSocketIo();
    if (io) {
      io.emit(SERVER_EVENTS.LISTENER_STATUS_CHANGED, {
        listenerId,
        status,
      });
    }
  }
}

export default new PresenceService();
