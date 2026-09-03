import crypto from 'crypto';
import mongoose from 'mongoose';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../constants/socket-event.constant.js';
import presenceService from '../services/presence.service.js';
import communicationSessionService from '../services/communication-session.service.js';
import listenerInteractionService from '../services/listener-interaction.service.js';
import listenerService from '../services/listener.service.js';
import { walletService } from '../services/wallet.service.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { stringToUid, buildChannelName } from '../utils/agora.util.js';
import agoraService from '../services/agora.service.js';
import config from '../config/index.js';
import logger from '../utils/logger.util.js';
import { RING_REQUEST_TTL_SEC } from '../constants/ring.constant.js';
import { acquireCallLocks, claimAndAcceptCall, releaseCallLocks } from '../utils/call-lua.util.js';
import {
  enqueueSessionStarted,
  enqueueSessionEnded,
  enqueueSessionSegmentSwitched,
} from '../queues/session-persistence.queue.js';
import { emitToSession } from '../utils/socket-room.util.js';

/** @deprecated use RING_REQUEST_TTL_SEC */
export const CALL_REQUEST_TTL_SEC = RING_REQUEST_TTL_SEC;

/**
 * CallHandler – Socket.io real-time signaling for bidirectional audio/video calls.
 * 
 * Features:
 * - Ultra-low latency Redis-first zero-DB hot signaling path (p95 < 20-50ms)
 * - Bidirectional calling: Customer -> Listener and Listener -> Customer
 * - Invariant: Customer is ALWAYS the payer, Listener is ALWAYS the earner
 * - Atomic 2-user concurrency locks via Redis Lua scripts
 * - Receiver ownership verification during accept
 * - Durable async persistence to MongoDB via BullMQ queue
 */
class CallHandler {
  register(io, socket) {
    socket.on(CLIENT_EVENTS.REQUEST_CALL, (data) => this.requestCall(io, socket, data));
    socket.on(CLIENT_EVENTS.ACCEPT_CALL, (data) => this.acceptCall(io, socket, data));
    socket.on(CLIENT_EVENTS.REJECT_CALL, (data) => this.rejectCall(io, socket, data));
    socket.on(CLIENT_EVENTS.CANCEL_CALL, (data) => this.cancelCall(io, socket, data));
    socket.on(CLIENT_EVENTS.END_CALL, (data) => this.endCall(io, socket, data));
  }

  /**
   * REQUEST_CALL: Initiate an outbound audio/video call.
   * Universal: Supports both Customer -> Listener and Listener -> Customer.
   */
  async requestCall(io, socket, data = {}) {
    const callerId = socket.user.id;
    const targetUserId = data.targetUserId || data.listenerId || data.customerId;
    const { mode } = data;

    try {
      if (!targetUserId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Target user ID is required.' });
      }
      if (!mode || !['AUDIO', 'VIDEO'].includes(mode)) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Mode must be AUDIO or VIDEO.' });
      }
      if (callerId === targetUserId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You cannot call yourself.' });
      }

      // ── Determine Payer (Customer) and Earner (Listener) ──
      const callerRole = socket.user.type; // 'CUSTOMER' or 'LISTENER'
      let customerId;
      let listenerId;
      let receiverRole;

      if (callerRole === 'CUSTOMER') {
        customerId = callerId;
        listenerId = targetUserId;
        receiverRole = 'LISTENER';
      } else if (callerRole === 'LISTENER') {
        listenerId = callerId;
        customerId = targetUserId;
        receiverRole = 'CUSTOMER';
      } else {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Invalid caller role.' });
      }

      // ── Parallel Pre-flight Checks (Redis Cached) ──
      const [
        existingCallerSession,
        existingTargetSession,
        targetPresence,
        listenerProfile,
        customerWallet,
      ] = await Promise.all([
        communicationSessionService.getActiveSessionForUser(callerId),
        communicationSessionService.getActiveSessionForUser(targetUserId),
        presenceService.getStatus(targetUserId),
        listenerService.getProfile(listenerId).catch(() => null),
        walletService.getOrCreateWallet(customerId).catch(() => null),
      ]);

      // ── Verify In-Session Upgrade vs Independent Call ──
      let isUpgrade = false;
      let sharedSessionId = null;

      if (existingCallerSession && existingTargetSession && existingCallerSession === existingTargetSession) {
        isUpgrade = true;
        sharedSessionId = existingCallerSession;
      } else {
        if (targetPresence !== 'ONLINE' && targetPresence !== 'LIVE') {
          return socket.emit(SERVER_EVENTS.ERROR, {
            message: targetPresence === 'BUSY' ? 'User is currently busy on another call.' : 'User is offline.',
          });
        }
        if (existingCallerSession) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are already in an active session.' });
        }
        if (existingTargetSession) {
          return socket.emit(SERVER_EVENTS.ERROR, { message: 'User is currently in an active session.' });
        }
      }

      // ── Server-Authoritative Rate & KYC Check ──
      if (!listenerProfile || listenerProfile.kycStatus !== 'APPROVED') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Listener profile is not verified or available.' });
      }

      const ratePerMinute = mode === 'VIDEO'
        ? (listenerProfile.videoRate || 0)
        : (listenerProfile.voiceRate || 0);

      if (ratePerMinute <= 0) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: `Listener has not set a rate for ${mode} calls.` });
      }

      // ── Customer Wallet Balance Protection ──
      const coinBalance = customerWallet ? (customerWallet.coinBalance || 0) : 0;
      if (coinBalance < ratePerMinute) {
        const errorMsg = callerRole === 'CUSTOMER'
          ? `Insufficient balance. You need at least ${ratePerMinute} coins.`
          : `Customer has insufficient balance to receive a ${mode} call.`;
        return socket.emit(SERVER_EVENTS.ERROR, { message: errorMsg });
      }

      // ── Atomic 2-User Lua Lock ──
      const callRequestId = crypto.randomUUID();
      const payload = {
        type: 'CALL',
        callRequestId,
        callerId,
        receiverId: targetUserId,
        customerId,
        listenerId,
        callerRole,
        receiverRole,
        mode,
        ratePerMinute,
        isUpgrade,
        sessionId: sharedSessionId,
        status: 'RINGING',
        createdAt: new Date().toISOString(),
        callerInfo: {
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          profileImage: socket.user.profileImage || null,
          userType: socket.user.type,
        },
      };

      const lockAcquired = await acquireCallLocks(
        callerId,
        targetUserId,
        callRequestId,
        payload,
        RING_REQUEST_TTL_SEC
      );

      if (!lockAcquired) {
        return socket.emit(SERVER_EVENTS.ERROR, {
          message: 'User is currently ringing or on another call.',
        });
      }

      // Backward compatibility key for legacy listeners/customers
      if (redisClient.isRedisAvailable) {
        await redisClient.set(
          KEYS.callRequest(targetUserId, callerId),
          JSON.stringify(payload),
          'EX',
          RING_REQUEST_TTL_SEC
        );
      }

      // ── Emit Incoming Call to Receiver ──
      io.to(targetUserId).emit(SERVER_EVENTS.INCOMING_CALL_REQUEST, {
        callRequestId,
        callerId,
        receiverId: targetUserId,
        customerId,
        listenerId,
        callerInfo: payload.callerInfo,
        mode,
        ratePerMinute,
        isUpgrade,
        sessionId: sharedSessionId,
      });

      // Confirm dial state to caller
      socket.emit('call_ringing', {
        callRequestId,
        targetUserId,
        mode,
        ratePerMinute,
      });

      // Non-blocking interaction tracking
      listenerInteractionService
        .markListenerCustomerInteraction(listenerId, customerId)
        .catch((err) => logger.warn(`[Interaction Track] ${err.message}`));

      logger.info(`[Socket Request Call] ${callerRole} ${callerId} → ${receiverRole} ${targetUserId} (${mode}, ${ratePerMinute}/min, ReqId: ${callRequestId})`);
    } catch (err) {
      logger.error(`[Socket Request Call Error] ${err.message}`, err);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to request call.' });
    }
  }

  /**
   * ACCEPT_CALL: Answer an incoming call request.
   * Validates receiver ownership, updates Redis atomic state, and connects Agora RTC.
   */
  async acceptCall(io, socket, data = {}) {
    const acceptingUserId = socket.user.id;
    let { callRequestId, callerId } = data;
    let sessionId = null;

    try {
      if (!redisClient.isRedisAvailable) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Service temporarily unavailable.' });
      }

      // ── Resolve callRequestId ──
      if (!callRequestId) {
        callRequestId = await redisClient.get(KEYS.userActiveCallRing(acceptingUserId));
      }
      if (!callRequestId && callerId) {
        const legacyRaw = await redisClient.get(KEYS.callRequest(acceptingUserId, callerId));
        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw);
          callRequestId = parsed.callRequestId;
        }
      }

      if (!callRequestId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Call request expired or not found.' });
      }

      // Prepare new sessionId
      sessionId = new mongoose.Types.ObjectId().toString();

      // Read raw request to get session metadata
      const rawReq = await redisClient.get(KEYS.callRequestById(callRequestId));
      if (!rawReq) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Call request expired or not found.' });
      }

      const reqData = JSON.parse(rawReq);
      const isUpgrade = Boolean(reqData.isUpgrade);
      const actualSessionId = isUpgrade && reqData.sessionId ? reqData.sessionId : sessionId;

      const sessionHashObj = {
        callerId: reqData.customerId.toString(), // Customer is always payer
        listenerId: reqData.listenerId.toString(), // Listener is always earner
        ratePerMinute: reqData.ratePerMinute.toString(),
        startTime: new Date().toISOString(),
        lastBilledAt: new Date().toISOString(),
        segmentId: new mongoose.Types.ObjectId().toString(),
        mode: reqData.mode,
      };

      // ── Atomic Lua Claim, State Transition, BUSY set & Lock Release ──
      const luaResult = await claimAndAcceptCall(
        callRequestId,
        acceptingUserId,
        actualSessionId,
        sessionHashObj
      );

      if (luaResult.status === 'NOT_FOUND') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Call request expired or not found.' });
      }
      if (luaResult.status === 'UNAUTHORIZED') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'You are not authorized to accept this call.' });
      }
      if (luaResult.status === 'INVALID_STATE') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: `Call is no longer ringing (${luaResult.currentStatus}).` });
      }
      if (luaResult.status !== 'OK') {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to accept call.' });
      }

      // ── Fast In-Memory Agora Token Generation (HMAC-SHA256: < 1ms) ──
      const channelName = buildChannelName(actualSessionId);
      const callerUid = stringToUid(reqData.callerId);
      const receiverUid = stringToUid(reqData.receiverId);

      let callerToken;
      let receiverToken;
      try {
        callerToken = agoraService.generateRtcToken(channelName, callerUid, 'PUBLISHER', 3600);
        receiverToken = agoraService.generateRtcToken(channelName, receiverUid, 'PUBLISHER', 3600);
      } catch (agoraErr) {
        logger.error(`[Socket Accept Call] Agora token generation failed: ${agoraErr.message}`);
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Media setup failed. Please try again.' });
      }

      const agoraAppId = config.agora.appId || '';

      // ── Emit Signaling Events to Both Parties Immediately (< 5ms) ──
      io.to(reqData.callerId).emit(SERVER_EVENTS.CALL_REQUEST_ACCEPTED, {
        callRequestId,
        sessionId: actualSessionId,
        callerId: reqData.callerId,
        receiverId: reqData.receiverId,
        customerId: reqData.customerId,
        listenerId: reqData.listenerId,
        mode: reqData.mode,
        isUpgrade,
        agora: {
          appId: agoraAppId,
          token: callerToken,
          channelName,
          uid: callerUid,
        },
      });

      socket.emit(SERVER_EVENTS.CALL_STARTED, {
        callRequestId,
        sessionId: actualSessionId,
        callerId: reqData.callerId,
        receiverId: reqData.receiverId,
        customerId: reqData.customerId,
        listenerId: reqData.listenerId,
        mode: reqData.mode,
        isUpgrade,
        agora: {
          appId: agoraAppId,
          token: receiverToken,
          channelName,
          uid: receiverUid,
        },
      });

      // ── Durable Async MongoDB Persistence via BullMQ Queue ──
      if (isUpgrade) {
        enqueueSessionSegmentSwitched({
          sessionId: actualSessionId,
          newMode: reqData.mode,
          newRatePerMinute: reqData.ratePerMinute,
          switchedAt: sessionHashObj.startTime,
        }).catch((err) => logger.error(`[BullMQ Enqueue Error] ${err.message}`));
      } else {
        enqueueSessionStarted({
          sessionId: actualSessionId,
          callerId: reqData.customerId,
          listenerId: reqData.listenerId,
          mode: reqData.mode,
          ratePerMinute: reqData.ratePerMinute,
          startTime: sessionHashObj.startTime,
        }).catch((err) => logger.error(`[BullMQ Enqueue Error] ${err.message}`));
      }

      logger.info(`[Socket Accept Call] User ${acceptingUserId} accepted call ${callRequestId}. Session ${actualSessionId} active.`);
    } catch (err) {
      logger.error(`[Socket Accept Call Error] ${err.message}`, err);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to accept call.' });
    }
  }

  /**
   * REJECT_CALL: Decline an incoming call request.
   */
  async rejectCall(io, socket, data = {}) {
    const rejectingUserId = socket.user.id;
    let { callRequestId, callerId, reason } = data;

    try {
      if (!callRequestId && redisClient.isRedisAvailable) {
        callRequestId = await redisClient.get(KEYS.userActiveCallRing(rejectingUserId));
      }

      let otherUserId = callerId;
      if (callRequestId && redisClient.isRedisAvailable) {
        const raw = await redisClient.get(KEYS.callRequestById(callRequestId));
        if (raw) {
          const parsed = JSON.parse(raw);
          otherUserId = parsed.callerId === rejectingUserId ? parsed.receiverId : parsed.callerId;
          await releaseCallLocks(parsed.callerId, parsed.receiverId, callRequestId, 'REJECTED');
        }
      }

      if (otherUserId) {
        io.to(otherUserId).emit(SERVER_EVENTS.CALL_REQUEST_REJECTED, {
          callRequestId,
          userId: rejectingUserId,
          reason: reason || 'User declined the call.',
        });
      }

      logger.info(`[Socket Reject Call] User ${rejectingUserId} declined call ${callRequestId || 'N/A'}`);
    } catch (err) {
      logger.error(`[Socket Reject Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to reject call.' });
    }
  }

  /**
   * CANCEL_CALL: Cancel an outbound call before it is answered.
   */
  async cancelCall(io, socket, data = {}) {
    const cancellingUserId = socket.user.id;
    let { callRequestId, targetUserId, listenerId } = data;
    const targetId = targetUserId || listenerId;

    try {
      if (!callRequestId && redisClient.isRedisAvailable) {
        callRequestId = await redisClient.get(KEYS.userActiveCallRing(cancellingUserId));
      }

      let otherUserId = targetId;
      if (callRequestId && redisClient.isRedisAvailable) {
        const raw = await redisClient.get(KEYS.callRequestById(callRequestId));
        if (raw) {
          const parsed = JSON.parse(raw);
          otherUserId = parsed.callerId === cancellingUserId ? parsed.receiverId : parsed.callerId;
          await releaseCallLocks(parsed.callerId, parsed.receiverId, callRequestId, 'CANCELLED');
        }
      }

      if (otherUserId) {
        io.to(otherUserId).emit(SERVER_EVENTS.CALL_ENDED, {
          callRequestId,
          sessionId: null,
          reason: 'CALLER_CANCELLED',
          callerId: cancellingUserId,
        });
      }

      logger.info(`[Socket Cancel Call] User ${cancellingUserId} cancelled call ${callRequestId || 'N/A'}`);
    } catch (err) {
      logger.error(`[Socket Cancel Call Error] ${err.message}`);
    }
  }

  /**
   * END_CALL: Terminate an ongoing audio/video call.
   */
  async endCall(io, socket, data = {}) {
    const userId = socket.user.id;
    const { sessionId, endEntireSession = false } = data;

    try {
      if (!sessionId) {
        return socket.emit(SERVER_EVENTS.ERROR, { message: 'Session ID is required.' });
      }

      let sessionData = null;
      if (redisClient.isRedisAvailable) {
        sessionData = await redisClient.hgetall(KEYS.activeSession(sessionId));
      }

      let callerId = sessionData?.callerId;
      let listenerId = sessionData?.listenerId;

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

      // ── Clean up Redis Active Session & Restore Presence Immediately (< 2ms) ──
      if (redisClient.isRedisAvailable) {
        await Promise.all([
          redisClient.del(KEYS.activeSession(sessionId)),
          redisClient.del(KEYS.userSession(callerId)),
          redisClient.del(KEYS.userSession(listenerId)),
          presenceService.setAvailable(callerId),
          presenceService.setAvailable(listenerId),
        ]);
      }

      // Broadcast CALL_ENDED to session room
      emitToSession(io, sessionId, SERVER_EVENTS.CALL_ENDED, {
        sessionId,
        reason: disconnectReason,
        switchedToChat: false,
      });

      // ── Durable Async Settlement via BullMQ Queue ──
      const endTime = new Date().toISOString();
      enqueueSessionEnded({
        sessionId,
        endTime,
        disconnectReason,
      }).catch((err) => logger.error(`[BullMQ End Session Error] ${err.message}`));

      logger.info(`[Socket End Call] Session ${sessionId} ended by ${userId} (${disconnectReason}).`);
    } catch (err) {
      logger.error(`[Socket End Call Error] ${err.message}`);
      socket.emit(SERVER_EVENTS.ERROR, { message: 'Failed to end call.' });
    }
  }
}

export default new CallHandler();
