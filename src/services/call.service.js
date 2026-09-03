import communicationSessionService from './communication-session.service.js';
import agoraService from './agora.service.js';
import presenceService from './presence.service.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import Wallet from '../modules/wallet.model.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { stringToUid, buildChannelName } from '../utils/agora.util.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.util.js';

/**
 * CallService – High-level orchestration for audio/video call sessions.
 *
 * Handles pre-call validations, session creation, Agora token issuance,
 * and session teardown. Works alongside the existing billing cron and
 * communication session lifecycle.
 */
class CallService {

  /**
   * Initiate a new audio or video call session.
   *
   * Pre-conditions checked:
   *  1. Caller must be a CUSTOMER.
   *  2. Listener must be ONLINE and KYC-approved.
   *  3. Caller must not already be in an active session.
   *  4. Caller wallet must have enough coins for ≥ 1 minute at the listener's rate.
   *
   * @param {string} callerId    - MongoDB ObjectId of the caller.
   * @param {string} listenerId  - MongoDB ObjectId of the listener.
   * @param {string} mode        - 'AUDIO' or 'VIDEO'.
   * @returns {Object} { session, agoraToken, channelName, agoraUid, agoraAppId }
   */
  async initiateCall(callerId, targetUserId, mode, callerRole = 'CUSTOMER') {
    // 1. Validate mode
    if (!['AUDIO', 'VIDEO'].includes(mode)) {
      throw new ApiError(400, 'Mode must be AUDIO or VIDEO.');
    }

    // 2. Prevent self-call
    if (callerId === targetUserId) {
      throw new ApiError(400, 'You cannot call yourself.');
    }

    // 3. Determine Payer (Customer) and Earner (Listener)
    let customerId;
    let listenerId;

    if (callerRole === 'CUSTOMER') {
      customerId = callerId;
      listenerId = targetUserId;
    } else if (callerRole === 'LISTENER') {
      listenerId = callerId;
      customerId = targetUserId;
    } else {
      throw new ApiError(400, 'Invalid caller role.');
    }

    // 4. Check active sessions to detect in-session upgrade vs new call
    const [existingCallerSession, existingTargetSession] = await Promise.all([
      communicationSessionService.getActiveSessionForUser(callerId),
      communicationSessionService.getActiveSessionForUser(targetUserId),
    ]);

    let isUpgrade = false;
    let sharedSessionId = null;

    if (existingCallerSession && existingTargetSession && existingCallerSession === existingTargetSession) {
      isUpgrade = true;
      sharedSessionId = existingCallerSession;
    } else {
      const targetStatus = await presenceService.getStatus(targetUserId);
      if (targetStatus !== 'ONLINE' && targetStatus !== 'LIVE') {
        throw new ApiError(
          400,
          targetStatus === 'BUSY'
            ? 'User is currently busy in another session.'
            : 'User is offline.'
        );
      }

      if (existingCallerSession) {
        throw new ApiError(409, 'You are already in an active session.');
      }
      if (existingTargetSession) {
        throw new ApiError(409, 'User is currently busy.');
      }
    }

    // 5. Fetch listener profile and customer wallet in parallel
    const [listenerProfile, customerWallet] = await Promise.all([
      ListenerProfile.findOne({ userId: listenerId }).lean(),
      Wallet.findOne({ userId: customerId }).lean(),
    ]);

    if (!listenerProfile) {
      throw new ApiError(404, 'Listener profile not found.');
    }
    if (listenerProfile.kycStatus !== 'APPROVED') {
      throw new ApiError(403, 'Listener is not verified.');
    }

    const ratePerMinute = mode === 'VIDEO'
      ? (listenerProfile.videoRate || 0)
      : (listenerProfile.voiceRate || 0);

    if (ratePerMinute <= 0) {
      throw new ApiError(400, `Listener has not set a rate for ${mode} calls.`);
    }

    // 6. Verify customer wallet balance ≥ 1 minute
    const coinBalance = customerWallet ? customerWallet.coinBalance : 0;
    if (coinBalance < ratePerMinute) {
      const msg = callerRole === 'CUSTOMER'
        ? `Insufficient balance. You need at least ${ratePerMinute} coins to start a ${mode} call.`
        : `Customer has insufficient balance to receive a ${mode} call.`;
      throw new ApiError(402, msg);
    }

    // 7. Switch segment if upgrade, otherwise start new session
    let session;
    let sessionId;

    if (isUpgrade) {
      sessionId = sharedSessionId;
      const switched = await communicationSessionService.switchSessionSegment(sessionId, mode, ratePerMinute);
      session = switched.session;
    } else {
      session = await communicationSessionService.startSession(
        customerId,
        listenerId,
        mode,
        ratePerMinute
      );
      sessionId = session._id.toString();
    }

    // 8. Generate Agora token for the caller
    const channelName = buildChannelName(sessionId);
    const agoraUid = stringToUid(callerId);

    const agoraToken = agoraService.generateRtcToken(
      channelName,
      agoraUid,
      'PUBLISHER',
      3600
    );

    logger.info(`[Call Service] Call initiated: caller=${callerId}, target=${targetUserId}, mode=${mode}, session=${sessionId}, isUpgrade=${isUpgrade}`);

    return {
      session,
      sessionId,
      isUpgrade,
      agoraToken,
      channelName,
      agoraUid,
      agoraAppId: config.agora.appId || 'test-app-id',
    };
  }

  /**
   * Generate a fresh Agora token for an authenticated user who is
   * already part of an active session (e.g. listener joining, or token refresh).
   *
   * @param {string} userId    - The requesting user's MongoDB ObjectId.
   * @param {string} sessionId - The CommunicationSession ObjectId.
   * @returns {Object} { agoraToken, channelName, agoraUid, agoraAppId }
   */
  async getTokenForSession(userId, sessionId) {
    // 1. Validate session existence and user membership
    let callerId, listenerId;

    if (redisClient.isRedisAvailable) {
      const sessionData = await redisClient.hgetall(KEYS.activeSession(sessionId));
      if (sessionData && sessionData.callerId) {
        callerId = sessionData.callerId;
        listenerId = sessionData.listenerId;
      }
    }

    if (!callerId) {
      // Fallback to DB
      const sessionDoc = await communicationSessionService.getItemById(sessionId);
      if (!sessionDoc) {
        throw new ApiError(404, 'Session not found.');
      }
      if (sessionDoc.status !== 'ONGOING') {
        throw new ApiError(400, 'Session is not active.');
      }
      callerId = sessionDoc.callerId.toString();
      listenerId = sessionDoc.listenerId.toString();
    }

    // 2. Authorisation – user must be a participant
    if (userId !== callerId && userId !== listenerId) {
      throw new ApiError(403, 'You are not a participant in this session.');
    }

    // 3. Generate token
    const channelName = buildChannelName(sessionId);
    const agoraUid = stringToUid(userId);

    const agoraToken = agoraService.generateRtcToken(
      channelName,
      agoraUid,
      'PUBLISHER',
      3600
    );

    logger.info(`[Call Service] Token issued for user=${userId}, session=${sessionId}`);

    return {
      agoraToken,
      channelName,
      agoraUid,
      agoraAppId: config.agora.appId || 'test-app-id',
    };
  }

  /**
   * End an active call session.
   * Delegates to the existing communicationSessionService.endSession()
   * which handles billing, Redis cleanup, and listener availability.
   *
   * @param {string} userId    - The user requesting to end the call.
   * @param {string} sessionId - The CommunicationSession ObjectId.
   * @returns {Object|null} The completed session document.
   */
  async endCall(userId, sessionId, revertToChat = true) {
    // 1. Validate session and membership
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
        throw new ApiError(400, 'Session is already ended or does not exist.');
      }
      callerId = sessionDoc.callerId.toString();
      listenerId = sessionDoc.listenerId.toString();
    }

    if (userId !== callerId && userId !== listenerId) {
      throw new ApiError(403, 'You are not authorised to end this session.');
    }

    const disconnectReason = userId === callerId
      ? 'CALLER_DISCONNECTED'
      : 'LISTENER_DISCONNECTED';

    if (revertToChat) {
      const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
      const chatRate = listenerProfile ? (listenerProfile.chatRate ?? 0) : 0;
      const result = await communicationSessionService.switchSessionSegment(sessionId, 'CHAT', chatRate);
      logger.info(`[Call Service] Call ended: session=${sessionId}, reverted to CHAT.`);
      return { ...result, switchedToChat: true };
    }

    const result = await communicationSessionService.endSession(sessionId, disconnectReason);
    logger.info(`[Call Service] Call and session fully ended: session=${sessionId}, by=${userId}, reason=${disconnectReason}`);
    return result;
  }
}

export default new CallService();
