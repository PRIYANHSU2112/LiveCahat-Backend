import cron from 'node-cron';
import liveRoomRepository from '../repositories/live-room.repository.js';
import liveRoomService from '../services/live-room.service.js';
import liveBillingService from '../services/live-billing.service.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import logger from '../utils/logger.util.js';

/**
 * Background Presence & Live Room Sweeper Job.
 * Runs every 60 seconds to detect orphaned live rooms where host connection dropped.
 *
 * @param {Object} io - Socket.io Server instance
 */
export const initializePresenceSweeperJob = (io) => {
  cron.schedule('*/1 * * * *', async () => {
    try {
      if (!redisClient.isRedisAvailable) return;

      // Find all live rooms
      const activeRooms = await liveRoomRepository.findLiveRooms(0, 100);
      if (!activeRooms || activeRooms.length === 0) return;

      for (const room of activeRooms) {
        const hostId = room.hostId?._id?.toString?.() || room.hostId?.toString?.() || room.hostId;
        if (!hostId) continue;

        // Check if host has active sockets in Redis
        const connCount = await redisClient.scard(KEYS.presenceConnections(hostId));
        const graceKey = await redisClient.get(KEYS.liveRoomDisconnectGrace(hostId));

        // If host has 0 sockets and disconnect grace has already expired (> 30s)
        if (connCount === 0 && !graceKey) {
          const roomId = room._id.toString();
          logger.warn(`[PresenceSweeper] Detected orphaned live room ${roomId} (Host ${hostId} has 0 sockets). Auto-ending.`);

          if (io) {
            io.to(roomId).emit(SERVER_EVENTS.LIVE_ENDED, {
              roomId,
              reason: 'ORPHAN_CLEANUP',
              message: 'Live stream ended due to host inactivity.',
            });
          }

          // Reconcile and settle all active viewer billing before closing the room
          await liveBillingService.reconcileRoomBilling(roomId);
          await liveRoomService.endRoom(roomId, hostId);
        }
      }
    } catch (err) {
      logger.error(`[PresenceSweeper] Sweeper job error: ${err.message}`);
    }
  });

  logger.info('Background presence & live room sweeper job initialized.');
};
