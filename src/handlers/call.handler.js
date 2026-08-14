import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import listenerInteractionService from '../services/listener-interaction.service.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Wallet from '../modules/wallet.model.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { stringToUid, buildChannelName } from '../utils/agora.util.js';
import agoraService from '../services/agora.service.js';
import config from '../config/index.js';
import logger from '../utils/logger.util.js';
import { RING_REQUEST_TTL_SEC } from '../constants/ring.constant.js';

/** @deprecated use RING_REQUEST_TTL_SEC */
export const CALL_REQUEST_TTL_SEC = RING_REQUEST_TTL_SEC;

/**
 * Atomically claim a Redis ring request (GET + DEL).
 * Prevents double-accept from banner + full-screen UI.
 */
async function claimRequest(requestKey) {
  if (typeof redisClient.getdel === 'function') {
    const raw = await redisClient.getdel(requestKey);
    if (raw) return raw;
  }
  const raw = await redisClient.eval(
    "local v = redis.call('GET', KEYS[1]); if v then redis.call('DEL', KEYS[1]) end; return v",
    1,
    requestKey
  );
  return raw;
}

/**
 * CallHandler – Socket.io real-time signaling for audio/video calls.
 */
class CallHandler {
  register(io, socket) {
    socket.on(CLIENT_EVENTS.REQUEST_CALL, (data) => this.requestCall(io, socket, data));
    socket.on(CLIENT_EVENTS.ACCEPT_CALL, (data) => this.acceptCall(io, socket, data));
    socket.on(CLIENT_EVENTS.REJECT_CALL, (data) => this.rejectCall(io, socket, data));
    socket.on(CLIENT_EVENTS.CANCEL_CALL, (data) => this.cancelCall(io, socket, data));
    socket.on(CLIENT_EVENTS.END_CALL, (data) => this.endCall(io, socket, data));
  }

  async requestCall(io, socket, data) {
    const callerId = socket.user.id;
    const { listenerId, mode } = data;

    try {
      if (!listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener ID is required.' });
      }
      if (!mode || !['AUDIO', 'VIDEO'].includes(mode)) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Mode must be AUDIO or VIDEO.' });
      }
      if (callerId === listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You cannot call yourself.' });
      }
      if (socket.user.type !== 'CUSTOMER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only customers can initiate calls.' });
      }

      // Check active sessions to detect if caller and listener are already in the SAME active session
      const existingCallerSession = await communicationSessionService.getActiveSessionForUser(callerId);
      const existingListenerSession = await communicationSessionService.getActiveSessionForUser(listenerId);

      let isUpgrade = false;
      let sharedSessionId = null;

      if (existingCallerSession && existingListenerSession && existingCallerSession === existingListenerSession) {
        // Caller and Listener are already in the SAME active session (e.g. active CHAT session) -> In-session Upgrade
        isUpgrade = true;
        sharedSessionId = existingCallerSession;
      } else {
        // Independent call request -> verify listener presence and that neither user is in an active session
        const listenerStatus = await presenceService.getStatus(listenerId);
        if (listenerStatus !== 'ONLINE' && listenerStatus !== 'LIVE') {
          return socket.emit(SERVER_EVENTS.ERROR, {
            message: listenerStatus === 'BUSY' ? 'Listener is currently busy.' : 'Listener is offline.',
          });
        }

        if (existingCallerSession) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
        }
        if (existingListenerSession) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener is currently busy.' });
        }
      }

      const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
      if (!listenerProfile || listenerProfile.kycStatus !== 'APPROVED') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener is not verified.' });
      }

      const ratePerMinute = mode === 'VIDEO'
        ? (listenerProfile.videoRate || 0)
        : (listenerProfile.voiceRate || 0);

      if (ratePerMinute <= 0) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: `Listener has not set a rate for ${mode} calls.` });
      }

      const callerWallet = await Wallet.findOne({ userId: callerId }).lean();
      const coinBalance = callerWallet ? callerWallet.coinBalance : 0;
      if (coinBalance < ratePerMinute) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: `Insufficient balance. You need at least ${ratePerMinute} coins.`,
        });
      }

      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable. Please try again.' });
      }

      const requestKey = KEYS.callRequest(listenerId, callerId);
      const payload = JSON.stringify({
        type: 'CALL',
        callerId,
        listenerId,
        mode,
        ratePerMinute,
        isUpgrade,
        sessionId: sharedSessionId,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profileImage: socket.user.profileImage || null,
        },
      });
      await redisClient.set(requestKey, payload, 'EX', RING_REQUEST_TTL_SEC);

      await listenerInteractionService.markListenerCustomerInteraction(listenerId, callerId);

      io.to(listenerId).emit(SERVER_EVENTS.INCOMING_CALL_REQUEST, {
        callerId,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profileImage: socket.user.profileImage || null,
        },
        mode,
        ratePerMinute,
        isUpgrade,
        sessionId: sharedSessionId,
      });

      logger.info(`[Socket Request Call] Caller ${callerId} → Listener ${listenerId} (${mode}, ${ratePerMinute}/min, Upgrade: ${isUpgrade})`);
    } catch (err) {
      logger.error(`[Socket Request Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to request call.' });
    }
  }

  async acceptCall(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId } = data;
    let sessionId = null;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required to accept call.' });
      }
      if (socket.user.type !== 'LISTENER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only listeners can accept call requests.' });
      }

      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable.' });
      }

      let rawRequest = await claimRequest(KEYS.callRequest(listenerId, callerId));
      if (!rawRequest) {
        rawRequest = await claimRequest(KEYS.chatRequest(listenerId, callerId));
      }
      if (!rawRequest) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Call request expired or not found.' });
      }

      let requestData;
      try {
        requestData = JSON.parse(rawRequest);
      } catch {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Call request expired or not found.' });
      }

      if (requestData.type === 'CHAT' || (requestData.chatRate != null && !requestData.mode)) {
        await redisClient.set(
          KEYS.chatRequest(listenerId, callerId),
          rawRequest,
          'EX',
          RING_REQUEST_TTL_SEC
        );
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'This is a chat request, not a call. Accept from chat.',
        });
      }

      const { mode, ratePerMinute, isUpgrade, sessionId: reqSessionId } = requestData;
      if (!mode || !['AUDIO', 'VIDEO'].includes(mode)) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Invalid call request.' });
      }

      const existingListener = await communicationSessionService.getActiveSessionForUser(listenerId);
      const existingCaller = await communicationSessionService.getActiveSessionForUser(callerId);

      let session;
      const isSameActiveSession = (existingListener && existingCaller && existingListener === existingCaller);

      if (isUpgrade || isSameActiveSession) {
        // Upgrade existing shared parent session!
        sessionId = reqSessionId || existingListener;
        const switched = await communicationSessionService.switchSessionSegment(sessionId, mode, ratePerMinute);
        session = switched.session;
      } else {
        if (existingListener) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
        }
        if (existingCaller) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller is already in an active session.' });
        }

        session = await communicationSessionService.startSession(
          callerId,
          listenerId,
          mode,
          ratePerMinute
        );
        sessionId = session._id.toString();
      }

      const channelName = buildChannelName(sessionId);
      const callerUid = stringToUid(callerId);
      const listenerUid = stringToUid(listenerId);

      let callerToken;
      let listenerToken;
      try {
        callerToken = agoraService.generateRtcToken(channelName, callerUid, 'PUBLISHER', 3600);
        listenerToken = agoraService.generateRtcToken(channelName, listenerUid, 'PUBLISHER', 3600);
      } catch (agoraErr) {
        logger.error(`[Socket Accept Call] Agora token failed: ${agoraErr.message}`);
        if (!isUpgrade && !isSameActiveSession) {
          await communicationSessionService.abortSession(sessionId, 'AGORA_SETUP_FAILED');
        }
        sessionId = null;
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'Call media setup failed. Please try again.',
        });
      }

      const agoraAppId = config.agora.appId || '';

      io.to(callerId).emit(SERVER_EVENTS.CALL_REQUEST_ACCEPTED, {
        sessionId,
        listenerId,
        mode,
        isUpgrade: Boolean(isUpgrade || isSameActiveSession),
        agora: {
          appId: agoraAppId,
          token: callerToken,
          channelName,
          uid: callerUid,
        },
      });

      socket.emit(SERVER_EVENTS.CALL_STARTED, {
        sessionId,
        callerId,
        mode,
        isUpgrade: Boolean(isUpgrade || isSameActiveSession),
        agora: {
          appId: agoraAppId,
          token: listenerToken,
          channelName,
          uid: listenerUid,
        },
      });

      logger.info(`[Socket Accept Call] Listener ${listenerId} accepted call from ${callerId}. Session ${sessionId} (${mode}, Upgrade: ${isUpgrade || isSameActiveSession})`);
    } catch (err) {
      logger.error(`[Socket Accept Call Error] ${err.message}`, err);
      socket.emit(SERVER_EVENTS.ERROR, {
        message: err?.message || 'Failed to accept call.',
      });
    }
  }

  async rejectCall(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId, reason } = data;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required.' });
      }

      if (redisClient.isRedisAvailable) {
        await redisClient.del(KEYS.callRequest(listenerId, callerId));
        await redisClient.del(KEYS.chatRequest(listenerId, callerId));
      }

      const active = await communicationSessionService.getActiveSessionForUser(listenerId);
      if (!active) {
        const status = await presenceService.getStatus(listenerId);
        if (status === 'BUSY') {
          await presenceService.setAvailable(listenerId);
        }
      }

      io.to(callerId).emit(SERVER_EVENTS.CALL_REQUEST_REJECTED, {
        listenerId,
        reason: reason || 'Listener declined the call.',
      });

      logger.info(`[Socket Reject Call] Listener ${listenerId} rejected call from ${callerId}. Reason: ${reason || 'N/A'}`);
    } catch (err) {
      logger.error(`[Socket Reject Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to reject call.' });
    }
  }

  async cancelCall(io, socket, data) {
    const callerId = socket.user.id;
    const { listenerId } = data || {};

    try {
      if (!listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener ID is required.' });
      }

      if (redisClient.isRedisAvailable) {
        await redisClient.del(KEYS.callRequest(listenerId, callerId));
        await redisClient.del(KEYS.chatRequest(listenerId, callerId));
      }

      io.to(listenerId).emit(SERVER_EVENTS.CALL_ENDED, {
        reason: 'CALLER_CANCELLED',
        callerId,
      });

      logger.info(`[Socket Cancel Call] Caller ${callerId} cancelled call to ${listenerId}`);
    } catch (err) {
      logger.error(`[Socket Cancel Call Error] ${err.message}`);
    }
  }

  async endCall(io, socket, data) {
    const userId = socket.user.id;
    const { sessionId, endEntireSession = false } = data || {};

    try {
      if (!sessionId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session ID is required.' });
      }

      let callerId;
      let listenerId;

      if (redisClient.isRedisAvailable) {
        const sessionData = await redisClient.hgetall(KEYS.activeSession(sessionId));
        if (sessionData && sessionData.callerId) {
          callerId = sessionData.callerId;
          listenerId = sessionData.listenerId;
        }
      }

      if (!callerId) {
        const sessionDoc = await communicationSessionService.getItemById(sessionId);
        if (!sessionDoc || sessionDoc.status !== 'ONGOING') {
          return socket.emit(SERVER_EVENTS.CALL_ENDED, { sessionId, reason: 'ALREADY_ENDED' });
        }
        callerId = sessionDoc.callerId.toString();
        listenerId = sessionDoc.listenerId.toString();
      }

      if (userId !== callerId && userId !== listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Unauthorised action.' });
      }

      const disconnectReason = userId === callerId ? 'CALLER_DISCONNECTED' : 'LISTENER_DISCONNECTED';

      // Check listener profile to switch segment back to CHAT
      const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
      const chatRate = listenerProfile ? (listenerProfile.chatRate ?? 0) : 0;

      const { emitToSession } = await import('../utils/socket-room.util.js');

      if (!endEntireSession && listenerProfile) {
        // In-Session Return to CHAT!
        await communicationSessionService.switchSessionSegment(sessionId, 'CHAT', chatRate);

        emitToSession(io, sessionId, SERVER_EVENTS.CALL_ENDED, {
          sessionId,
          reason: disconnectReason,
          switchedToChat: true,
          chatRate,
        });

        logger.info(`[Socket End Call] Call ended for Session ${sessionId} by ${userId}. Switched back to CHAT.`);
      } else {
        // Full session termination
        emitToSession(io, sessionId, SERVER_EVENTS.CALL_ENDED, {
          sessionId,
          reason: disconnectReason,
          switchedToChat: false,
        });

        await communicationSessionService.endSession(sessionId, disconnectReason);
        logger.info(`[Socket End Call] Session ${sessionId} fully ended by ${userId}. Reason: ${disconnectReason}`);
      }
    } catch (err) {
      logger.error(`[Socket End Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to end call.' });
    }
  }
}

export default new CallHandler();
