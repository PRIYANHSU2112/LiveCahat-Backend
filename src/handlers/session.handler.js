import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import communicationSessionService from '../services/communication-session.service.js';
import { joinSessionRoom, emitToSession } from '../utils/socket-room.util.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import logger from '../utils/logger.util.js';

class SessionHandler {
  /**
   * Register event listeners for session operations.
   */
  register(io, socket) {
    socket.on(CLIENT_EVENTS.JOIN_SESSION, (data) => this.joinSession(io, socket, data));
    socket.on(CLIENT_EVENTS.END_CHAT, (data) => this.endChat(io, socket, data));
  }

  /**
   * User (caller or listener) joins the session socket room.
   */
  async joinSession(io, socket, data) {
    const userId = socket.user.id;
    const { sessionId } = data;

    try {
      if (!sessionId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session ID is required.' });
      }

      // Validate session exists and is active
      let sessionData = null;
      if (redisClient.isRedisAvailable) {
        sessionData = await redisClient.hgetall(KEYS.activeSession(sessionId));
      }

      let callerId, listenerId;
      if (sessionData && sessionData.callerId) {
        callerId = sessionData.callerId;
        listenerId = sessionData.listenerId;
      } else {
        // Fallback to DB query
        const sessionDoc = await communicationSessionService.getItemById(sessionId);
        if (!sessionDoc || sessionDoc.status !== 'ONGOING') {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session is not active or does not exist.' });
        }
        callerId = sessionDoc.callerId.toString();
        listenerId = sessionDoc.listenerId.toString();
      }

      // Check if current user is authorized to join this session
      if (userId !== callerId && userId !== listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Unauthorized access to this session.' });
      }

      // Join room
      joinSessionRoom(socket, sessionId);
      logger.info(`[Socket Join Session] User ${userId} joined session room session:${sessionId}`);

      // Notify room members
      emitToSession(io, sessionId, 'user_joined', { userId });
    } catch (err) {
      logger.error(`[Socket Join Session Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to join session.' });
    }
  }

  /**
   * User manually ends the chat session.
   */
  async endChat(io, socket, data) {
    const userId = socket.user.id;
    const { sessionId } = data;

    try {
      if (!sessionId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session ID is required.' });
      }

      // Fetch active session from Redis/DB
      let sessionData = null;
      if (redisClient.isRedisAvailable) {
        sessionData = await redisClient.hgetall(KEYS.activeSession(sessionId));
      }

      let callerId, listenerId;
      if (sessionData && sessionData.callerId) {
        callerId = sessionData.callerId;
        listenerId = sessionData.listenerId;
      } else {
        const sessionDoc = await communicationSessionService.getItemById(sessionId);
        if (!sessionDoc || sessionDoc.status !== 'ONGOING') {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session is already ended.' });
        }
        callerId = sessionDoc.callerId.toString();
        listenerId = sessionDoc.listenerId.toString();
      }

      if (userId !== callerId && userId !== listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Unauthorized action.' });
      }

      const disconnectReason = userId === callerId ? 'CALLER_DISCONNECTED' : 'LISTENER_DISCONNECTED';

      // Emit end event to all users in the session room
      emitToSession(io, sessionId, SERVER_EVENTS.CHAT_ENDED, {
        sessionId,
        reason: disconnectReason,
      });

      // Execute session tear-down, billing updates and availability resets
      await communicationSessionService.endSession(sessionId, disconnectReason);

      logger.info(`[Socket End Chat] Session ${sessionId} manually ended by user ${userId}. Reason: ${disconnectReason}`);
    } catch (err) {
      logger.error(`[Socket End Chat Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to end chat.' });
    }
  }
}

export default new SessionHandler();
