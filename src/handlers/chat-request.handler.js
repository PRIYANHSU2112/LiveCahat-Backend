import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import listenerInteractionService from '../services/listener-interaction.service.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Wallet from '../modules/wallet.model.js';
import logger from '../utils/logger.util.js';

class ChatRequestHandler {
  /**
   * Register event listeners for chat request flow.
   */
  register(io, socket) {
    socket.on(CLIENT_EVENTS.REQUEST_CHAT, (data) => this.requestChat(io, socket, data));
    socket.on(CLIENT_EVENTS.ACCEPT_CHAT, (data) => this.acceptChat(io, socket, data));
    socket.on(CLIENT_EVENTS.REJECT_CHAT, (data) => this.rejectChat(io, socket, data));
  }

  /**
   * Caller requests a 1-to-1 chat with a listener.
   */
  async requestChat(io, socket, data) {
    const callerId = socket.user.id;
    const { listenerId } = data;

    try {
      if (!listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener ID is required.' });
      }

      if (callerId === listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You cannot request a chat with yourself.' });
      }

      // 1. Check caller is a CUSTOMER
      if (socket.user.type !== 'CUSTOMER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only customers can request chat sessions.' });
      }

      // 2. Check listener status
      const listenerStatus = await presenceService.getStatus(listenerId);
      if (listenerStatus !== 'ONLINE') {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: listenerStatus === 'BUSY' ? 'Listener is currently busy.' : 'Listener is offline.'
        });
      }

      // 3. Verify caller has no active session
      const existingSession = await communicationSessionService.getActiveSessionForUser(callerId);
      if (existingSession) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
      }

      // 4. Fetch listener profile rates
      const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
      if (!listenerProfile) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener profile not found.' });
      }

      if (listenerProfile.kycStatus !== 'APPROVED') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener is not verified.' });
      }

      const chatRate = listenerProfile.chatRate || 0;

      // 5. Verify caller wallet has enough balance for at least 1 minute
      const callerWallet = await Wallet.findOne({ userId: callerId }).lean();
      const coinBalance = callerWallet ? callerWallet.coinBalance : 0;
      if (coinBalance < chatRate) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: `Insufficient balance. You need at least ${chatRate} coins to start a chat.`
        });
      }

      // 6. Store chat request in Redis with a 30s TTL
      if (redisClient.isRedisAvailable) {
        const requestKey = KEYS.chatRequest(listenerId, callerId);
        const payload = JSON.stringify({
          callerId,
          listenerId,
          chatRate,
          callerInfo: {
            firstName: socket.user.firstName,
            lastName: socket.user.lastName,
          }
        });
        await redisClient.set(requestKey, payload, 'EX', 30);

        await listenerInteractionService.markListenerCustomerInteraction(listenerId, callerId);
      } else {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable. Please try again.' });
      }

      // 7. Send notification to listener
      io.to(listenerId).emit(SERVER_EVENTS.INCOMING_CHAT_REQUEST, {
        callerId,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
        },
        chatRate,
      });

      logger.info(`[Socket Request Chat] Caller ${callerId} requested chat with listener ${listenerId} (Rate: ${chatRate}/min).`);
    } catch (err) {
      logger.error(`[Socket Request Chat Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to request chat.' });
    }
  }

  /**
   * Listener accepts the incoming request.
   */
  async acceptChat(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId } = data;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required to accept chat.' });
      }

      // 1. Verify user is a LISTENER
      if (socket.user.type !== 'LISTENER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only listeners can accept chat requests.' });
      }

      // 2. Fetch the request payload from Redis
      let requestData = null;
      if (redisClient.isRedisAvailable) {
        const requestKey = KEYS.chatRequest(listenerId, callerId);
        const rawRequest = await redisClient.get(requestKey);
        if (!rawRequest) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'Chat request expired or not found.' });
        }
        requestData = JSON.parse(rawRequest);
        // Delete the request key
        await redisClient.del(requestKey);
      } else {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable.' });
      }

      const { chatRate } = requestData;

      // 3. Initialize communication session & segment
      const session = await communicationSessionService.startSession(callerId, listenerId, 'CHAT', chatRate);
      const sessionIdStr = session._id.toString();

      // 4. Notify caller that the chat request was accepted
      io.to(callerId).emit(SERVER_EVENTS.CHAT_REQUEST_ACCEPTED, {
        sessionId: sessionIdStr,
        listenerId,
      });

      // 5. Notify listener that the chat session has started
      socket.emit(SERVER_EVENTS.CHAT_STARTED, {
        sessionId: sessionIdStr,
        callerId,
      });

      logger.info(`[Socket Accept Chat] Listener ${listenerId} accepted request from caller ${callerId}. Session ${sessionIdStr} started.`);
    } catch (err) {
      logger.error(`[Socket Accept Chat Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to accept chat.' });
    }
  }

  /**
   * Listener rejects the incoming request.
   */
  async rejectChat(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId, reason } = data;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required.' });
      }

      // Remove request from Redis
      if (redisClient.isRedisAvailable) {
        const requestKey = KEYS.chatRequest(listenerId, callerId);
        await redisClient.del(requestKey);
      }

      // Notify caller of rejection
      io.to(callerId).emit(SERVER_EVENTS.CHAT_REQUEST_REJECTED, {
        listenerId,
        reason: reason || 'Listener declined the request.',
      });

      logger.info(`[Socket Reject Chat] Listener ${listenerId} rejected request from caller ${callerId}. Reason: ${reason}`);
    } catch (err) {
      logger.error(`[Socket Reject Chat Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to reject chat.' });
    }
  }
}

export default new ChatRequestHandler();
