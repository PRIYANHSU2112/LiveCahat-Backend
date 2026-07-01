import BaseService from './base.service.js';
import communicationSessionRepository from '../repositories/communication-session.repository.js';
import sessionSegmentRepository from '../repositories/session-segment.repository.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import User from '../modules/user.model.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import presenceService from './presence.service.js';
import logger from '../utils/logger.util.js';
import listenerInteractionService from './listener-interaction.service.js';
import xpService from './xp.service.js';

class CommunicationSessionService extends BaseService {
  constructor() {
    super(communicationSessionRepository);
  }

  /**
   * Start a new chat/call session and create the initial segment.
   */
  async startSession(callerId, listenerId, mode, ratePerMinute) {
    const startTime = new Date();

    // 1. Create communication session in MongoDB
    const session = await this.repository.create({
      callerId,
      listenerId,
      startTime,
      status: 'ONGOING',
    });

    // 2. Create the first session segment in MongoDB
    const segment = await sessionSegmentRepository.create({
      sessionId: session._id,
      mode,
      startTime,
      ratePerMinute,
      status: 'ONGOING',
    });

    const sessionIdStr = session._id.toString();
    const segmentIdStr = segment._id.toString();

    // 3. Write active session state to Redis hash
    if (redisClient.isRedisAvailable) {
      const activeSessionKey = KEYS.activeSession(sessionIdStr);
      await redisClient.hset(activeSessionKey, {
        callerId: callerId.toString(),
        listenerId: listenerId.toString(),
        ratePerMinute: ratePerMinute.toString(),
        startTime: startTime.toISOString(),
        lastBilledAt: startTime.toISOString(),
        segmentId: segmentIdStr,
        mode,
      });

      // Map users to this active session
      await redisClient.set(KEYS.userSession(callerId.toString()), sessionIdStr);
      await redisClient.set(KEYS.userSession(listenerId.toString()), sessionIdStr);
    }

    // 4. Update listener presence status to BUSY
    await presenceService.setBusy(listenerId.toString());

    await listenerInteractionService.markListenerCustomerInteraction(
      listenerId,
      callerId,
      { emit: false }
    );

    return session;
  }

  /**
   * End an ongoing session, calculate final billing charges, and update DB/Redis.
   */
  async endSession(sessionId, disconnectReason) {
    try {
      const sessionIdStr = sessionId.toString();
      const session = await this.repository.findById(sessionIdStr, '', '', false);
      if (!session || session.status !== 'ONGOING') {
        logger.warn(`[Session Service] Session ${sessionIdStr} already completed or not found.`);
        return null;
      }

      const endTime = new Date();
      const durationSeconds = Math.max(0, Math.floor((endTime.getTime() - session.startTime.getTime()) / 1000));

      // Import billingService dynamically to avoid circular dependencies
      const { default: billingService } = await import('./billing.service.js');

      // 1. Process final billing cycle for this session specifically
      await billingService.billSession(sessionIdStr, endTime, true);

      // 2. Fetch the session segments to aggregate totals
      const segments = await sessionSegmentRepository.findManyBySessionId(sessionIdStr);
      let totalCoinsSpent = 0;
      for (const segment of segments) {
        totalCoinsSpent += segment.coinsCharged;
      }

      // Read split percentage from listener profile to calculate final earnings
      const listenerProfile = await ListenerProfile.findOne({ userId: session.listenerId });
      const earningPercent = listenerProfile?.earningPercent || 70; // 70/30 split default
      const totalCoinsEarned = Math.floor(totalCoinsSpent * (earningPercent / 100));

      // Update segment fields
      const activeSegment = segments.find(seg => seg.status === 'ONGOING');
      if (activeSegment) {
        const segDuration = Math.max(0, Math.floor((endTime.getTime() - activeSegment.startTime.getTime()) / 1000));
        await sessionSegmentRepository.updateById(activeSegment._id, {
          status: 'COMPLETED',
          endTime,
          duration: segDuration,
        });
      }

      // Update session document
      session.status = 'COMPLETED';
      session.endTime = endTime;
      session.duration = durationSeconds;
      session.totalCoinsSpent = totalCoinsSpent;
      session.totalCoinsEarned = totalCoinsEarned;
      session.disconnectReason = disconnectReason;
      await session.save();

      // Update listener profile totals
      if (listenerProfile) {
        listenerProfile.totalSessions = (listenerProfile.totalSessions || 0) + 1;
        await listenerProfile.save();

        if (listenerProfile.createdByAgentId) {
          const { default: agentService } = await import('./agent.service.js');
          await agentService.bumpCache(listenerProfile.createdByAgentId.toString());
        }
      }

      // 3. Clear session keys in Redis
      if (redisClient.isRedisAvailable) {
        await redisClient.del(KEYS.activeSession(sessionIdStr));
        await redisClient.del(KEYS.userSession(session.callerId.toString()));
        await redisClient.del(KEYS.userSession(session.listenerId.toString()));
        // Clean grace periods
        await redisClient.del(KEYS.disconnectGrace(session.callerId.toString()));
        await redisClient.del(KEYS.disconnectGrace(session.listenerId.toString()));
      }

      // 4. Mark listener available (ONLINE) if they are still connected
      const listenerOnline = await presenceService.getStatus(session.listenerId.toString());
      if (listenerOnline !== 'OFFLINE') {
        await presenceService.setAvailable(session.listenerId.toString());
      } else {
        await ListenerProfile.findOneAndUpdate({ userId: session.listenerId }, { availability: 'OFFLINE' });
        presenceService.broadcastStatusChange(session.listenerId.toString(), 'OFFLINE');
      }

      logger.info(`[Session Service] Session ${sessionIdStr} ended successfully. Reason: ${disconnectReason}`);

      // Fire-and-forget XP awards for both caller and listener
      try {
        // Determine call type from segment mode
        const lastSegment = segments[segments.length - 1];
        const xpAction = lastSegment?.mode === 'VIDEO' ? 'VIDEO_CALL' : 'VOICE_CALL';

        // Award both participants XP for completing the session
        const sessionMeta = { sessionId: sessionIdStr };
        xpService.awardXp(session.callerId, xpAction, sessionMeta).catch(() => {});
        xpService.awardXp(session.listenerId, xpAction, sessionMeta).catch(() => {});

        // Award FIRST_CALL XP (one-time, atomic guard handles dedup)
        xpService.awardXp(session.callerId, 'FIRST_CALL', sessionMeta).catch(() => {});
        xpService.awardXp(session.listenerId, 'FIRST_CALL', sessionMeta).catch(() => {});
      } catch (xpErr) {
        logger.error(`[Session XP] Failed to award session XP: ${xpErr.message}`);
      }

      return session;
    } catch (err) {
      logger.error(`[Session Service End Error] Failed for session ${sessionId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Fetch active session for a given user (Redis first, DB fallback).
   */
  async getActiveSessionForUser(userId) {
    const userIdStr = userId.toString();

    if (redisClient.isRedisAvailable) {
      const sessionId = await redisClient.get(KEYS.userSession(userIdStr));
      if (sessionId) {
        return sessionId;
      }
    }

    // DB Fallback
    const session = await this.repository.findActiveByUserId(userIdStr);
    return session ? session._id.toString() : null;
  }
}

export default new CommunicationSessionService();
