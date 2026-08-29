import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import agentDashboardService from '../services/agent-dashboard.service.js';
import liveRoomService from '../services/live-room.service.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import logger from '../utils/logger.util.js';

/** Delay before ending session on disconnect — covers token-refresh reconnect */
const DISCONNECT_GRACE_MS = 4500;
const pendingSessionEnds = new Map();

class ConnectionHandler {
  /**
   * Called when a client successfully authenticates and establishes connection.
   */
  async handleConnection(io, socket) {
    const userId = socket.user.id;
    const userType = socket.user.type;

    logger.info(`[Socket Connection] User ${userId} (${userType}) connected via socket ${socket.id}`);

    // Cancel any pending disconnect session teardown (token refresh / brief blip)
    const pending = pendingSessionEnds.get(userId);
    if (pending) {
      clearTimeout(pending);
      pendingSessionEnds.delete(userId);
      logger.info(`[Socket Connection] Cancelled pending session end for ${userId}`);
    }

    // Cancel any pending live room auto-end grace period on reconnect / auth success
    try {
      await liveRoomService.clearDisconnectGrace(userId);
    } catch (graceErr) {
      logger.error(`[Socket Connection] Failed to clear live disconnect grace for ${userId}: ${graceErr.message}`);
    }

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

    // Grace period: token refresh reconnects quickly — don't kill the call/chat
    try {
      const activeSessionId = await communicationSessionService.getActiveSessionForUser(userId);
      if (!activeSessionId) return;

      if (pendingSessionEnds.has(userId)) {
        clearTimeout(pendingSessionEnds.get(userId));
      }

      const timer = setTimeout(async () => {
        pendingSessionEnds.delete(userId);
        try {
          // Still disconnected with no other sockets?
          if (redisClient.isRedisAvailable) {
            const connCount = await redisClient.scard(KEYS.presenceConnections(userId));
            if (connCount > 0) {
              logger.info(
                `[Socket Disconnect] User ${userId} reconnected during grace — keep session ${activeSessionId}`,
              );
              return;
            }
          }

          const stillActive = await communicationSessionService.getActiveSessionForUser(userId);
          if (!stillActive || stillActive !== activeSessionId) return;

          logger.info(
            `[Socket Disconnect] Grace expired for ${userId}. Ending session ${activeSessionId}.`,
          );

          const disconnectReason =
            userType === 'LISTENER' ? 'LISTENER_DISCONNECTED' : 'CALLER_DISCONNECTED';

          io.to(`session:${activeSessionId}`).emit(SERVER_EVENTS.CALL_ENDED, {
            sessionId: activeSessionId,
            reason: disconnectReason,
          });
          io.to(`session:${activeSessionId}`).emit(SERVER_EVENTS.CHAT_ENDED, {
            sessionId: activeSessionId,
            reason: disconnectReason,
          });

          await communicationSessionService.endSession(activeSessionId, disconnectReason);
        } catch (err) {
          logger.error(`[Socket Disconnect Session End Error] ${err.message}`);
        }
      }, DISCONNECT_GRACE_MS);

      pendingSessionEnds.set(userId, timer);
      logger.info(
        `[Socket Disconnect] Scheduled session end for ${userId} in ${DISCONNECT_GRACE_MS}ms`,
      );
    } catch (err) {
      logger.error(`[Socket Disconnect Session End Error] Failed to end session: ${err.message}`);
    }
  }
}

export default new ConnectionHandler();
