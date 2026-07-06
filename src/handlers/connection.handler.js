import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import agentDashboardService from '../services/agent-dashboard.service.js';
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

    if (userType === 'AGENT') {
      const agentRoom = agentDashboardService.agentRoom(userId);
      socket.join(agentRoom);
      const snapshot = await agentDashboardService.getLiveSnapshot(userId);
      socket.emit(SERVER_EVENTS.AGENT_DASHBOARD_LIVE, snapshot);
      
      // Allow client to request fresh snapshot on demand (e.g. on component remount)
      socket.on('agent:dashboard:live:request', async () => {
        const freshSnapshot = await agentDashboardService.getLiveSnapshot(userId);
        socket.emit(SERVER_EVENTS.AGENT_DASHBOARD_LIVE, freshSnapshot);
      });
    }

    // Track presence online
    await presenceService.goOnline(userId, socket.id, userType);

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

    // End active session immediately on socket disconnect
    try {
      const activeSessionId = await communicationSessionService.getActiveSessionForUser(userId);
      if (activeSessionId) {
        logger.info(`[Socket Disconnect] User ${userId} has active session ${activeSessionId}. Ending session immediately.`);

        const disconnectReason = userType === 'LISTENER' ? 'LISTENER_DISCONNECTED' : 'CALLER_DISCONNECTED';

        // Notify session room that the chat has ended
        io.to(`session:${activeSessionId}`).emit(SERVER_EVENTS.CHAT_ENDED, {
          sessionId: activeSessionId,
          reason: disconnectReason,
        });

        // Conclude session lifecycle in database & Redis keys
        await communicationSessionService.endSession(activeSessionId, disconnectReason);
      }
    } catch (err) {
      logger.error(`[Socket Disconnect Session End Error] Failed to end session: ${err.message}`);
    }
  }
}

export default new ConnectionHandler();
