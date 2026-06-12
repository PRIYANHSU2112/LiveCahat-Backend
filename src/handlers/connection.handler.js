import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import logger from '../utils/logger.util.js';

class ConnectionHandler {
  /**
   * Called when a client successfully authenticates and establishes connection.
   */
  async handleConnection(io, socket) {
    const userId = socket.user.id;
    const userType = socket.user.type;

    logger.info(`[Socket Connection] User ${userId} (${userType}) connected via socket ${socket.id}`);

    // Join user-specific private room
    socket.join(userId);

    // Track presence online
    await presenceService.goOnline(userId, socket.id, userType);

    // Reconnection Grace Check:
    // If user has a disconnect grace key in Redis, it means they reconnected within 15 seconds.
    if (redisClient.isRedisAvailable) {
      const graceKey = KEYS.disconnectGrace(userId);
      const sessionId = await redisClient.get(graceKey);

      if (sessionId) {
        logger.info(`[Socket Reconnection] User ${userId} reconnected to active session ${sessionId}. Cancelling grace period.`);
        // Cancel the grace period by deleting the key
        await redisClient.del(graceKey);

        // Client joins the session room automatically
        socket.join(`session:${sessionId}`);

        // Notify both parties that the user reconnected
        io.to(`session:${sessionId}`).emit('user_reconnected', { userId });
      }
    }

    // Register disconnect listener
    socket.on('disconnect', () => this.handleDisconnect(io, socket));
  }

  /**
   * Called when a client disconnects.
   */
  async handleDisconnect(io, socket) {
    const userId = socket.user.id;
    const userType = socket.user.type;

    logger.info(`[Socket Disconnect] User ${userId} disconnected from socket ${socket.id}`);

    // Track presence offline
    await presenceService.goOffline(userId, socket.id, userType);

    // Grace period check for active call/chat
    if (redisClient.isRedisAvailable) {
      const graceKey = KEYS.disconnectGrace(userId);

      // Delay check by 15.5 seconds to allow the grace period to complete or be cancelled
      setTimeout(async () => {
        try {
          const sessionId = await redisClient.get(graceKey);

          if (sessionId) {
            // Grace key still exists. User did NOT reconnect.
            logger.info(`[Socket Disconnect Grace Timeout] User ${userId} failed to reconnect within 15 seconds. Ending session ${sessionId}.`);

            // Delete grace key
            await redisClient.del(graceKey);

            // Notify session room that the chat has ended due to disconnect
            io.to(`session:${sessionId}`).emit(SERVER_EVENTS.CHAT_ENDED, {
              sessionId,
              reason: 'USER_DISCONNECTED',
            });

            // Conclude session lifecycle in database & Redis keys
            await communicationSessionService.endSession(sessionId, 'USER_DISCONNECTED');
          }
        } catch (err) {
          logger.error(`[Socket Disconnect Grace Timeout Error] Failed to end session: ${err.message}`);
        }
      }, 15500); // 15.5s timeout (slightly longer than Redis TTL of 15s)
    }
  }
}

export default new ConnectionHandler();
