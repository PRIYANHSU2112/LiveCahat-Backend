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
  async initiateCall(callerId, listenerId, mode) {
    // 1. Validate mode
    if (!['AUDIO', 'VIDEO'].includes(mode)) {
      throw new ApiError(400, 'Mode must be AUDIO or VIDEO.');
    }

    // 2. Prevent self-call
    if (callerId === listenerId) {
      throw new ApiError(400, 'You cannot call yourself.');
    }

    // 3. Check listener status via presence service
    const listenerStatus = await presenceService.getStatus(listenerId);
    if (listenerStatus !== 'ONLINE') {
      throw new ApiError(
        400,
        listenerStatus === 'BUSY'
          ? 'Listener is currently busy in another session.'
          : 'Listener is offline.'
      );
    }

    // 4. Verify caller has no active session
    const existingSession = await communicationSessionService.getActiveSessionForUser(callerId);
    if (existingSession) {
      throw new ApiError(409, 'You are already in an active session.');
    }

    // 5. Fetch listener profile for rate and KYC status
    const listenerProfile = await ListenerProfile.findOne({ userId: listenerId }).lean();
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

    // 6. Verify caller wallet balance ≥ 1 minute
    const callerWallet = await Wallet.findOne({ userId: callerId }).lean();
    const coinBalance = callerWallet ? callerWallet.coinBalance : 0;
    if (coinBalance < ratePerMinute) {
      throw new ApiError(402, `Insufficient balance. You need at least ${ratePerMinute} coins to start a ${mode} call.`);
    }

    // 7. Create communication session & first segment via existing service
    const session = await communicationSessionService.startSession(
      callerId,
      listenerId,
      mode,
      ratePerMinute
    );

    const sessionId = session._id.toString();

    // 8. Generate Agora token for the caller
    const channelName = buildChannelName(sessionId);
    const agoraUid = stringToUid(callerId);

    const agoraToken = agoraService.generateRtcToken(
      channelName,
      agoraUid,
      'PUBLISHER',
      3600
    );

    logger.info(`[Call Service] Call initiated: caller=${callerId}, listener=${listenerId}, mode=${mode}, session=${sessionId}`);

    return {
      session,
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
  async endCall(userId, sessionId) {
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

    const result = await communicationSessionService.endSession(sessionId, disconnectReason);

    logger.info(`[Call Service] Call ended: session=${sessionId}, by=${userId}, reason=${disconnectReason}`);
    return result;
  }
}

export default new CallService();
