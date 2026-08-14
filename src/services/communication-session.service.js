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

    // 4. Mark BUSY unless host is LIVE (keep LIVE badge while streaming)
    const currentPresence = await presenceService.getStatus(listenerId.toString());
    if (currentPresence !== 'LIVE') {
      await presenceService.setBusy(listenerId.toString());
    }

    await listenerInteractionService.markListenerCustomerInteraction(
      listenerId,
      callerId,
      { emit: false }
    );

    return session;
  }

  /**
   * Atomically switch communication segment within the same parent session.
   * e.g. CHAT -> AUDIO, AUDIO -> CHAT, CHAT -> VIDEO, etc.
   *
   * 1. Bill current active segment up to 'now'.
   * 2. Complete the current active segment (endTime: now, status: 'COMPLETED').
   * 3. Create a new segment (startTime: now, mode: newMode, ratePerMinute, status: 'ONGOING').
   * 4. Update Redis active_session hash with new segmentId, mode, ratePerMinute, and timestamps.
   */
  async switchSessionSegment(sessionId, newMode, newRatePerMinute) {
    const sessionIdStr = sessionId.toString();
    const session = await this.repository.findById(sessionIdStr, '', '', false);
    if (!session || session.status !== 'ONGOING') {
      const error = new Error('Session is not active or already ended.');
      error.statusCode = 400;
      throw error;
    }

    const now = new Date();

    // 1. Bill and settle the current active segment before closing it
    const { default: billingService } = await import('./billing.service.js');
    await billingService.billSession(sessionIdStr, now, true);

    // 2. Find and complete current active segment
    const activeSegment = await sessionSegmentRepository.findActiveBySessionId(sessionIdStr);
    if (activeSegment) {
      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - new Date(activeSegment.startTime).getTime()) / 1000)
      );
      await sessionSegmentRepository.updateById(activeSegment._id, {
        status: 'COMPLETED',
        endTime: now,
        duration: durationSeconds,
      });
    }

    // 3. Create the new segment
    const newSegment = await sessionSegmentRepository.create({
      sessionId: session._id,
      mode: newMode,
      ratePerMinute: Number(newRatePerMinute) || 0,
      startTime: now,
      status: 'ONGOING',
    });

    const newSegmentIdStr = newSegment._id.toString();

    // 4. Update Redis active_session hash atomically
    if (redisClient.isRedisAvailable) {
      const activeSessionKey = KEYS.activeSession(sessionIdStr);
      await redisClient.hset(activeSessionKey, {
        callerId: session.callerId.toString(),
        listenerId: session.listenerId.toString(),
        ratePerMinute: String(newRatePerMinute || 0),
        startTime: now.toISOString(),
        lastBilledAt: now.toISOString(),
        segmentId: newSegmentIdStr,
        mode: newMode,
      });
    }

    logger.info(
      `[Session Service] Session ${sessionIdStr} switched segment to ${newMode} (Rate: ${newRatePerMinute}/min, Segment: ${newSegmentIdStr})`
    );

    return {
      session,
      previousSegment: activeSegment,
      newSegment,
    };
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
          const agentId = listenerProfile.createdByAgentId.toString();
          const { default: agentService } = await import('./agent.service.js');
          await agentService.bumpCache(agentId);

          if (totalCoinsEarned > 0) {
            const { default: agentDashboardService } = await import('./agent-dashboard.service.js');
            await agentDashboardService.recordActivity(agentId, {
              type: 'revenue',
              text: `Revenue generated · ${totalCoinsEarned} coins`,
            });
            await agentDashboardService.emitLiveUpdate(agentId);
            await agentDashboardService.bumpCache(agentId);
          }
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

      // 4. Restore presence — keep LIVE if host still has an active room
      const listenerIdStr = session.listenerId.toString();
      const listenerOnline = await presenceService.getStatus(listenerIdStr);
      const { default: liveRoomService } = await import('./live-room.service.js');
      const activeLive = await liveRoomService
        .getActiveRoomByHost(listenerIdStr)
        .catch(() => null);

      if (activeLive) {
        await presenceService.setLive(listenerIdStr);
      } else if (listenerOnline !== 'OFFLINE') {
        await presenceService.setAvailable(listenerIdStr);
      } else {
        await ListenerProfile.findOneAndUpdate({ userId: session.listenerId }, { availability: 'OFFLINE' });
        presenceService.broadcastStatusChange(listenerIdStr, 'OFFLINE');
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
   * Stale Redis `user_session` keys (no active hash / not ONGOING) are cleared
   * so callers are not stuck with "already in an active session".
   */
  async getActiveSessionForUser(userId) {
    const userIdStr = userId.toString();

    if (redisClient.isRedisAvailable) {
      const sessionId = await redisClient.get(KEYS.userSession(userIdStr));
      if (sessionId) {
        const active = await redisClient.hgetall(KEYS.activeSession(sessionId));
        if (active && active.callerId) {
          return sessionId;
        }

        // Redis pointer is stale — verify DB before clearing
        const dbSession = await this.repository.findById(sessionId, '', '', false);
        if (dbSession && dbSession.status === 'ONGOING') {
          return sessionId;
        }

        await redisClient.del(KEYS.userSession(userIdStr));
        await redisClient.del(KEYS.activeSession(sessionId));
        logger.warn(`[Session Service] Cleared stale user_session for ${userIdStr} → ${sessionId}`);
      }
    }

    const session = await this.repository.findActiveByUserId(userIdStr);
    return session ? session._id.toString() : null;
  }

  /**
   * Abort a session that was created but never successfully handed to clients
   * (e.g. Agora token failure after startSession).
   */
  async abortSession(sessionId, reason = 'SYSTEM_ERROR') {
    try {
      return await this.endSession(sessionId, reason);
    } catch (err) {
      logger.error(`[Session Service] abortSession failed for ${sessionId}: ${err.message}`);
      // Best-effort Redis/presence cleanup if endSession blew up mid-billing
      try {
        const sessionIdStr = sessionId.toString();
        if (redisClient.isRedisAvailable) {
          const active = await redisClient.hgetall(KEYS.activeSession(sessionIdStr));
          await redisClient.del(KEYS.activeSession(sessionIdStr));
          if (active?.callerId) await redisClient.del(KEYS.userSession(active.callerId));
          if (active?.listenerId) {
            await redisClient.del(KEYS.userSession(active.listenerId));
            await presenceService.setAvailable(active.listenerId);
          }
        }
      } catch (cleanupErr) {
        logger.error(`[Session Service] abort cleanup failed: ${cleanupErr.message}`);
      }
      return null;
    }
  }
}

export default new CommunicationSessionService();
