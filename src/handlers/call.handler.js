import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import callService from '../services/call.service.js';
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

/**
 * CallHandler – Socket.io real-time signaling for audio/video calls.
 *
 * Flow:
 *  1. Caller emits `request_call` → server validates, stores request in Redis,
 *     and forwards `incoming_call_request` to the listener.
 *  2. Listener emits `accept_call` → server creates session, generates Agora
 *     tokens for both parties, and emits `call_request_accepted` / `call_started`.
 *  3. Either party emits `end_call` → server tears down the session and
 *     emits `call_ended` to the session room.
 *  4. Listener emits `reject_call` → server cleans up and notifies caller.
 */
class CallHandler {
  /**
   * Register call event listeners on the connected socket.
   */
  register(io, socket) {
    socket.on(CLIENT_EVENTS.REQUEST_CALL, (data) => this.requestCall(io, socket, data));
    socket.on(CLIENT_EVENTS.ACCEPT_CALL, (data) => this.acceptCall(io, socket, data));
    socket.on(CLIENT_EVENTS.REJECT_CALL, (data) => this.rejectCall(io, socket, data));
    socket.on(CLIENT_EVENTS.END_CALL, (data) => this.endCall(io, socket, data));
  }

  // ─── REQUEST ──────────────────────────────────────────────────────

  /**
   * Caller requests an audio or video call with a listener.
   * @param {Object} data - { listenerId: String, mode: 'AUDIO' | 'VIDEO' }
   */
  async requestCall(io, socket, data) {
    const callerId = socket.user.id;
    const { listenerId, mode } = data;

    try {
      // ── Basic validation ────────────────────────────────────────
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

      // ── Listener status ─────────────────────────────────────────
      const listenerStatus = await presenceService.getStatus(listenerId);
      if (listenerStatus !== 'ONLINE') {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: listenerStatus === 'BUSY' ? 'Listener is currently busy.' : 'Listener is offline.',
        });
      }

      // ── Existing session guard ──────────────────────────────────
      const existingSession = await communicationSessionService.getActiveSessionForUser(callerId);
      if (existingSession) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
      }

      // ── Listener profile & KYC ──────────────────────────────────
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

      // ── Wallet balance check ────────────────────────────────────
      const callerWallet = await Wallet.findOne({ userId: callerId }).lean();
      const coinBalance = callerWallet ? callerWallet.coinBalance : 0;
      if (coinBalance < ratePerMinute) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: `Insufficient balance. You need at least ${ratePerMinute} coins.`,
        });
      }

      // ── Store call request in Redis (30s TTL) ───────────────────
      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable. Please try again.' });
      }

      const requestKey = KEYS.chatRequest(listenerId, callerId); // Reuse same key pattern
      const payload = JSON.stringify({
        callerId,
        listenerId,
        mode,
        ratePerMinute,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
        },
      });
      await redisClient.set(requestKey, payload, 'EX', 30);

      await listenerInteractionService.markListenerCustomerInteraction(listenerId, callerId);

      // ── Notify listener ─────────────────────────────────────────
      io.to(listenerId).emit(SERVER_EVENTS.INCOMING_CALL_REQUEST, {
        callerId,
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
        },
        mode,
        ratePerMinute,
      });

      logger.info(`[Socket Request Call] Caller ${callerId} → Listener ${listenerId} (${mode}, ${ratePerMinute}/min)`);
    } catch (err) {
      logger.error(`[Socket Request Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to request call.' });
    }
  }

  // ─── ACCEPT ───────────────────────────────────────────────────────

  /**
   * Listener accepts the incoming call request.
   * @param {Object} data - { callerId: String }
   */
  async acceptCall(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId } = data;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required to accept call.' });
      }
      if (socket.user.type !== 'LISTENER') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Only listeners can accept call requests.' });
      }

      // ── Fetch & delete request from Redis ───────────────────────
      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable.' });
      }

      const requestKey = KEYS.chatRequest(listenerId, callerId);
      const rawRequest = await redisClient.get(requestKey);
      if (!rawRequest) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Call request expired or not found.' });
      }
      const requestData = JSON.parse(rawRequest);
      await redisClient.del(requestKey);

      const { mode, ratePerMinute } = requestData;

      // ── Create session ──────────────────────────────────────────
      const session = await communicationSessionService.startSession(
        callerId,
        listenerId,
        mode,
        ratePerMinute
      );
      const sessionId = session._id.toString();
      const channelName = buildChannelName(sessionId);

      // ── Generate Agora tokens for both participants ─────────────
      const callerUid = stringToUid(callerId);
      const listenerUid = stringToUid(listenerId);

      const callerToken = agoraService.generateRtcToken(channelName, callerUid, 'PUBLISHER', 3600);
      const listenerToken = agoraService.generateRtcToken(channelName, listenerUid, 'PUBLISHER', 3600);

      const agoraAppId = config.agora.appId || 'test-app-id';

      // ── Notify caller ───────────────────────────────────────────
      io.to(callerId).emit(SERVER_EVENTS.CALL_REQUEST_ACCEPTED, {
        sessionId,
        listenerId,
        mode,
        agora: {
          appId: agoraAppId,
          token: callerToken,
          channelName,
          uid: callerUid,
        },
      });

      // ── Notify listener (the accepting socket) ─────────────────
      socket.emit(SERVER_EVENTS.CALL_STARTED, {
        sessionId,
        callerId,
        mode,
        agora: {
          appId: agoraAppId,
          token: listenerToken,
          channelName,
          uid: listenerUid,
        },
      });

      logger.info(`[Socket Accept Call] Listener ${listenerId} accepted call from ${callerId}. Session ${sessionId} (${mode})`);
    } catch (err) {
      logger.error(`[Socket Accept Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to accept call.' });
    }
  }

  // ─── REJECT ───────────────────────────────────────────────────────

  /**
   * Listener rejects the incoming call request.
   * @param {Object} data - { callerId: String, reason?: String }
   */
  async rejectCall(io, socket, data) {
    const listenerId = socket.user.id;
    const { callerId, reason } = data;

    try {
      if (!callerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Caller ID is required.' });
      }

      // Clean up Redis request
      if (redisClient.isRedisAvailable) {
        const requestKey = KEYS.chatRequest(listenerId, callerId);
        await redisClient.del(requestKey);
      }

      // Notify caller
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

  // ─── END ──────────────────────────────────────────────────────────

  /**
   * Either party ends the active call.
   * @param {Object} data - { sessionId: String }
   */
  async endCall(io, socket, data) {
    const userId = socket.user.id;
    const { sessionId } = data;

    try {
      if (!sessionId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session ID is required.' });
      }

      // ── Validate session & membership ───────────────────────────
      let callerId, listenerId;

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
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session is already ended.' });
        }
        callerId = sessionDoc.callerId.toString();
        listenerId = sessionDoc.listenerId.toString();
      }

      if (userId !== callerId && userId !== listenerId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Unauthorised action.' });
      }

      const disconnectReason = userId === callerId ? 'CALLER_DISCONNECTED' : 'LISTENER_DISCONNECTED';

      // ── Broadcast end event to session room ─────────────────────
      const { emitToSession } = await import('../utils/socket-room.util.js');
      emitToSession(io, sessionId, SERVER_EVENTS.CALL_ENDED, {
        sessionId,
        reason: disconnectReason,
      });

      // ── Tear down session (billing, cleanup, availability) ──────
      await communicationSessionService.endSession(sessionId, disconnectReason);

      logger.info(`[Socket End Call] Session ${sessionId} ended by ${userId}. Reason: ${disconnectReason}`);
    } catch (err) {
      logger.error(`[Socket End Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to end call.' });
    }
  }
}

export default new CallHandler();
