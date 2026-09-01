import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import agentDashboardService from '../services/agent-dashboard.service.js';
import liveRoomService from '../services/live-room.service.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import logger from '../utils/logger.util.js';

/** Delay before ending 1-on-1 call/chat on disconnect — covers token-refresh reconnect */
const CALL_DISCONNECT_GRACE_MS = 10000;
/** Delay before ending live room on host disconnect — covers page refresh / network blip */
const LIVE_DISCONNECT_GRACE_MS = 15000;

const pendingSessionEnds = new Map();
const pendingLiveEnds = new Map();

class ConnectionHandler {
  /**
   * Called when a client successfully authenticates and establishes connection.
   */
  async handleConnection(io, socket) {
    const userId = socket.user.id;
    const userType = socket.user.type;

    logger.info(`[Socket Connection] User ${userId} (${userType}) connected via socket ${socket.id}`);

    // 1. Cancel any pending 1-on-1 session teardown (token refresh / brief blip)
    const pendingSession = pendingSessionEnds.get(userId);
    if (pendingSession) {
      clearTimeout(pendingSession);
      pendingSessionEnds.delete(userId);
      logger.info(`[Socket Connection] Cancelled pending session end for ${userId}`);
    }

    // 2. Cancel any pending live room auto-end grace period on reconnect / auth success
    const pendingLive = pendingLiveEnds.get(userId);
    if (pendingLive) {
      clearTimeout(pendingLive);
      pendingLiveEnds.delete(userId);
      logger.info(`[Socket Connection] Cancelled pending live room end for host ${userId}`);
    }

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

    // 1. Track presence offline in Redis
    await presenceService.goOffline(userId, socket.id, userType);

    // 2. Check and handle LIVE ROOM host disconnect
    if (userType === 'LISTENER') {
      try {
        const activeRoom = await liveRoomService.getActiveRoomByHost(userId);
        if (activeRoom && activeRoom.status === 'live') {
          const roomId = activeRoom._id.toString();

          if (pendingLiveEnds.has(userId)) {
            clearTimeout(pendingLiveEnds.get(userId));
          }

          const liveTimer = setTimeout(async () => {
            pendingLiveEnds.delete(userId);
            try {
              // Check if host reconnected via another socket
              if (redisClient.isRedisAvailable) {
                const connCount = await redisClient.scard(KEYS.presenceConnections(userId));
                if (connCount > 0) {
                  logger.info(`[Live Disconnect Grace] Host ${userId} reconnected during grace — keeping live room ${roomId}`);
                  return;
                }
              }

              // Verify room is still live
              const stillActive = await liveRoomService.getActiveRoomByHost(userId);
              if (!stillActive || stillActive._id.toString() !== roomId) return;

              logger.info(`[Live Disconnect Grace] Grace expired for host ${userId}. Ending live room ${roomId}.`);

              // Broadcast live:ended to all viewers in the room
              io.to(roomId).emit(SERVER_EVENTS.LIVE_ENDED, {
                roomId,
                reason: 'HOST_DISCONNECTED',
                message: 'Host disconnected from live stream.',
              });

              // End the room in MongoDB & flush comments / viewer stats
              await liveRoomService.endRoom(roomId, userId);
              await presenceService.goOffline(userId, socket.id, 'LISTENER');
            } catch (err) {
              logger.error(`[Live Disconnect Auto-End Error] ${err.message}`);
            }
          }, LIVE_DISCONNECT_GRACE_MS);

          pendingLiveEnds.set(userId, liveTimer);
          logger.info(`[Socket Disconnect] Scheduled live room auto-end for host ${userId} (Room: ${roomId}) in ${LIVE_DISCONNECT_GRACE_MS}ms`);
        }
      } catch (liveErr) {
        logger.error(`[Socket Disconnect Live Check Error] ${liveErr.message}`);
      }
    }

    // 3. Check and handle 1-on-1 CALL / CHAT session disconnect
    try {
      const activeSessionId = await communicationSessionService.getActiveSessionForUser(userId);
      if (!activeSessionId) return;

      if (pendingSessionEnds.has(userId)) {
        clearTimeout(pendingSessionEnds.get(userId));
      }

      const sessionTimer = setTimeout(async () => {
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
      }, CALL_DISCONNECT_GRACE_MS);

      pendingSessionEnds.set(userId, sessionTimer);
      logger.info(
        `[Socket Disconnect] Scheduled call session end for ${userId} in ${CALL_DISCONNECT_GRACE_MS}ms`,
      );
    } catch (err) {
      logger.error(`[Socket Disconnect Session End Error] Failed to end session: ${err.message}`);
    }
  }
}

export default new ConnectionHandler();
