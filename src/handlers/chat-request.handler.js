import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import listenerInteractionService from '../services/listener-interaction.service.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Wallet from '../modules/wallet.model.js';
import logger from '../utils/logger.util.js';
import { RING_REQUEST_TTL_SEC } from '../constants/ring.constant.js';

async function claimRequest(requestKey) {
  if (typeof redisClient.getdel === 'function') {
    const raw = await redisClient.getdel(requestKey);
    if (raw) return raw;
  }
  return redisClient.eval(
    "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
    1,
    requestKey
  );
}

class ChatRequestHandler {
  register(io, socket) {
    socket.on(CLIENT_EVENTS.REQUEST_CHAT, (data) => this.requestChat(io, socket, data));
    socket.on(CLIENT_EVENTS.ACCEPT_CHAT, (data) => this.acceptChat(io, socket, data));
    socket.on(CLIENT_EVENTS.REJECT_CHAT, (data) => this.rejectChat(io, socket, data));
    socket.on(CLIENT_EVENTS.CANCEL_CHAT, (data) => this.cancelChat(io, socket, data));
  }

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

      if (socket.user.type !== 'CUSTOMER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only customers can request chat sessions.' });
      }

      const listenerStatus = await presenceService.getStatus(listenerId);
      // Allow chat while LIVE (host messaging) as well as ONLINE
      if (listenerStatus !== 'ONLINE' && listenerStatus !== 'LIVE') {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: listenerStatus === 'BUSY' ? 'Listener is currently busy.' : 'Listener is offline.',
        });
      }

      const existingSession = await communicationSessionService.getActiveSessionForUser(callerId);
      if (existingSession) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
      }

      const listenerBusy = await communicationSessionService.getActiveSessionForUser(listenerId);
      if (listenerBusy) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener is currently busy.' });
      }

      const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
      if (!listenerProfile) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener profile not found.' });
      }

      if (listenerProfile.kycStatus !== 'APPROVED') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener is not verified.' });
      }

      const chatRate = listenerProfile.chatRate || 0;

      const callerWallet = await Wallet.findOne({ userId: callerId }).lean();
      const coinBalance = callerWallet ? callerWallet.coinBalance : 0;
      if (coinBalance < chatRate) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: `Insufficient balance. You need at least ${chatRate} coins to start a chat.`,
        });
      }

      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable. Please try again.' });
      }

      const requestKey = KEYS.chatRequest(listenerId, callerId);
      const payload = JSON.stringify({
        type: 'CHAT',
        callerId,
        listenerId,
        chatRate,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profileImage: socket.user.profileImage || null,
        },
      });
      await redisClient.set(requestKey, payload, 'EX', RING_REQUEST_TTL_SEC);

      await listenerInteractionService.markListenerCustomerInteraction(listenerId, callerId);

      io.to(listenerId).emit(SERVER_EVENTS.INCOMING_CHAT_REQUEST, {
        callerId,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profileImage: socket.user.profileImage || null,
        },
        chatRate,
      });

      logger.info(`[Socket Request Chat] Caller ${callerId} → Listener ${listenerId} (Rate: ${chatRate}/min).`);
    } catch (err) {
      logger.error(`[Socket Request Chat Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to request chat.' });
    }
  }

  async acceptChat(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId } = data;
    let sessionId = null;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required to accept chat.' });
      }

      if (socket.user.type !== 'LISTENER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only listeners can accept chat requests.' });
      }

      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable.' });
      }

      const rawRequest = await claimRequest(KEYS.chatRequest(listenerId, callerId));
      if (!rawRequest) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Chat request expired or not found.' });
      }

      let requestData;
      try {
        requestData = JSON.parse(rawRequest);
      } catch {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Chat request expired or not found.' });
      }

      if (requestData.type === 'CALL' || (requestData.mode && requestData.chatRate == null)) {
        await redisClient.set(
          KEYS.callRequest(listenerId, callerId),
          rawRequest,
          'EX',
          RING_REQUEST_TTL_SEC
        );
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'This is a call request, not a chat. Accept from call.',
        });
      }

      const chatRate = requestData.chatRate ?? 0;

      const existingListener = await communicationSessionService.getActiveSessionForUser(listenerId);
      if (existingListener) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
      }
      const existingCaller = await communicationSessionService.getActiveSessionForUser(callerId);
      if (existingCaller) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller is already in an active session.' });
      }

      const session = await communicationSessionService.startSession(
        callerId,
        listenerId,
        'CHAT',
        chatRate
      );
      sessionId = session._id.toString();

      io.to(callerId).emit(SERVER_EVENTS.CHAT_REQUEST_ACCEPTED, {
        sessionId,
        listenerId,
      });

      socket.emit(SERVER_EVENTS.CHAT_STARTED, {
        sessionId,
        callerId,
      });

      logger.info(`[Socket Accept Chat] Listener ${listenerId} accepted from ${callerId}. Session ${sessionId}`);
    } catch (err) {
      logger.error(`[Socket Accept Chat Error] ${err.message}`);
      if (sessionId) {
        try {
          await communicationSessionService.abortSession(sessionId, 'ACCEPT_FAILED');
        } catch (abortErr) {
          logger.error(`[Socket Accept Chat] abort failed: ${abortErr.message}`);
        }
      }
      socket.emit(SERVER_EVENTS.ERROR, { message: err?.message || 'Failed to accept chat.' });
    }
  }

  async rejectChat(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId, reason } = data;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required.' });
      }

      if (redisClient.isRedisAvailable) {
        await redisClient.del(KEYS.chatRequest(listenerId, callerId));
      }

      const active = await communicationSessionService.getActiveSessionForUser(listenerId);
      if (!active) {
        const status = await presenceService.getStatus(listenerId);
        if (status === 'BUSY') {
          await presenceService.setAvailable(listenerId);
        }
      }

      io.to(callerId).emit(SERVER_EVENTS.CHAT_REQUEST_REJECTED, {
        listenerId,
        reason: reason || 'Listener declined the request.',
      });

      logger.info(`[Socket Reject Chat] Listener ${listenerId} rejected ${callerId}. Reason: ${reason}`);
    } catch (err) {
      logger.error(`[Socket Reject Chat Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to reject chat.' });
    }
  }

  /**
   * Caller cancels a ringing chat before accept (mirrors cancel_call).
   */
  async cancelChat(io, socket, data) {
    const callerId = socket.user.id;
    const { listenerId } = data || {};

    try {
      if (!listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener ID is required.' });
      }

      if (redisClient.isRedisAvailable) {
        await redisClient.del(KEYS.chatRequest(listenerId, callerId));
      }

      io.to(listenerId).emit(SERVER_EVENTS.CHAT_ENDED, {
        reason: 'CALLER_CANCELLED',
        callerId,
      });

      logger.info(`[Socket Cancel Chat] Caller ${callerId} cancelled chat to ${listenerId}`);
    } catch (err) {
      logger.error(`[Socket Cancel Chat Error] ${err.message}`);
    }
  }
}

export default new ChatRequestHandler();
