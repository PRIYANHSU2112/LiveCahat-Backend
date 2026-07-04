import mongoose from 'mongoose';
import redisClient from '../config/redis.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import Withdrawal from '../modules/withdrawal.model.js';
import User from '../modules/user.model.js';
import SessionSegment from '../modules/session-segment.model.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';
import agentAnalyticsRepository from './agent-analytics.repository.js';

const RECEIVED_GIFT_TYPES = ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'];
const ACTIVITY_TTL_SECONDS = 7 * 24 * 60 * 60;
const ACTIVITY_MAX_ITEMS = 200;

const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));

class AgentDashboardRepository {
  async getListenerIdsForAgent(agentId) {
    return agentAnalyticsRepository.getListenerIdsForAgent(agentId);
  }

  async countApprovedListenersAt(agentId, asOf) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    return ListenerProfile.countDocuments({
      createdByAgentId: agentObjectId,
      kycStatus: 'APPROVED',
      $or: [{ kycApprovedAt: { $lte: asOf } }, { kycApprovedAt: null, createdAt: { $lte: asOf } }],
    });
  }

  async countNewListenersInRange(agentId, start, end) {
    return agentAnalyticsRepository.countNewListeners(agentId, start, end);
  }

  async countActiveListenersInRange(listenerIds, start, end) {
    return agentAnalyticsRepository.countActiveListenersInRange(listenerIds, start, end);
  }

  async sumEarningsInRange(listenerIds, start, end) {
    return agentAnalyticsRepository.sumEarningsInRange(listenerIds, start, end);
  }

  async getEarningsSeries(listenerIds, start, end, granularity) {
    return agentAnalyticsRepository.getEarningsSeries(listenerIds, start, end, granularity);
  }

  async countOnlineListeners(agentId) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    return ListenerProfile.countDocuments({
      createdByAgentId: agentObjectId,
      availability: { $in: ['ONLINE', 'BUSY'] },
    });
  }

  async countActiveSessions(agentId) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    return ListenerProfile.countDocuments({
      createdByAgentId: agentObjectId,
      availability: 'BUSY',
    });
  }

  /**
   * List listeners currently in ONGOING sessions for this agent (live feed).
   */
  async listActiveSessionsForAgent(agentId) {
    const listenerIds = await this.getListenerIdsForAgent(agentId);
    if (!listenerIds.length) return [];

    const ids = toObjectIds(listenerIds);
    const sessions = await CommunicationSession.find({
      listenerId: { $in: ids },
      status: 'ONGOING',
    })
      .sort({ startTime: -1 })
      .limit(20)
      .lean();

    if (!sessions.length) return [];

    const listenerObjectIds = sessions.map((s) => s.listenerId);
    const sessionIds = sessions.map((s) => s._id);

    const [users, segments] = await Promise.all([
      User.find({ _id: { $in: listenerObjectIds } })
        .select('firstName lastName')
        .lean(),
      SessionSegment.aggregate([
        { $match: { sessionId: { $in: sessionIds }, status: 'ONGOING' } },
        { $sort: { startTime: -1 } },
        {
          $group: {
            _id: '$sessionId',
            mode: { $first: '$mode' },
          },
        },
      ]),
    ]);

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    const modeMap = new Map(segments.map((s) => [s._id.toString(), s.mode]));

    const modeLabel = (mode) => {
      if (mode === 'VIDEO') return 'video';
      if (mode === 'AUDIO') return 'voice';
      if (mode === 'CHAT') return 'chat';
      return 'session';
    };

    return sessions.map((session) => {
      const uid = session.listenerId.toString();
      const u = userMap.get(uid);
      const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Listener';
      const mode = modeMap.get(session._id.toString()) || 'CHAT';
      const modeText = modeLabel(mode);
      return {
        id: session._id.toString(),
        type: 'session',
        listenerId: uid,
        listenerName: name || 'Listener',
        mode,
        text: `${name || 'Listener'} is in an active ${modeText} session`,
        startedAt: session.startTime?.toISOString?.() ?? new Date().toISOString(),
      };
    });
  }

  async countTodayRegistrations(agentId, startOfToday) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    return ListenerProfile.countDocuments({
      createdByAgentId: agentObjectId,
      kycStatus: 'APPROVED',
      $or: [
        { kycApprovedAt: { $gte: startOfToday } },
        { kycApprovedAt: null, createdAt: { $gte: startOfToday } },
      ],
    });
  }

  async getDailyActiveBuckets(listenerIds, start, end) {
    if (!listenerIds.length) return new Map();

    const ids = toObjectIds(listenerIds);
    const dateMatch = { createdAt: { $gte: start, $lte: end } };
    const groupId = {
      $floor: {
        $divide: [{ $hour: { date: '$createdAt', timezone: DASHBOARD_TZ } }, 4],
      },
    };

    const sessions = await CommunicationSession.aggregate([
      {
        $match: {
          listenerId: { $in: ids },
          status: 'COMPLETED',
          ...dateMatch,
        },
      },
      { $group: { _id: { bucket: groupId, listenerId: '$listenerId' } } },
      { $group: { _id: '$_id.bucket', value: { $sum: 1 } } },
    ]);

    const merged = new Map();
    for (const row of sessions) {
      merged.set(String(row._id), row.value);
    }
    return merged;
  }

  async pushActivity(agentId, item) {
    if (!redisClient.isRedisAvailable) return item;
    const key = KEYS.agentActivity(agentId);
    try {
      await redisClient.lpush(key, JSON.stringify(item));
      await redisClient.ltrim(key, 0, ACTIVITY_MAX_ITEMS - 1);
      await redisClient.expire(key, ACTIVITY_TTL_SECONDS);
    } catch {
      // non-fatal
    }
    return item;
  }

  async listActivity(agentId, limit = 20, cursor = 0) {
    const offset = Number(cursor) || 0;
    const take = Math.min(Number(limit) || 20, 50);

    if (redisClient.isRedisAvailable) {
      try {
        const key = KEYS.agentActivity(agentId);
        const raw = await redisClient.lrange(key, offset, offset + take - 1);
        const docs = (raw || [])
          .map((row) => {
            try {
              return JSON.parse(row);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        const total = await redisClient.llen(key);
        const hasMore = offset + docs.length < (total || 0);
        if (docs.length) {
          return {
            docs,
            meta: {
              hasMore,
              nextCursor: hasMore ? String(offset + docs.length) : null,
            },
          };
        }
      } catch {
        // fall through to DB
      }
    }

    return this.getActivityFallback(agentId, take);
  }

  async getActivityFallback(agentId, limit = 20) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const profiles = await ListenerProfile.find({ createdByAgentId: agentObjectId })
      .select('userId')
      .lean();
    const listenerIds = profiles.map((p) => p.userId);
    if (!listenerIds.length) {
      return { docs: [], meta: { hasMore: false, nextCursor: null } };
    }

    const ids = toObjectIds(listenerIds.map((id) => id.toString()));
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [approvals, gifts, sessions, withdrawals] = await Promise.all([
      ListenerProfile.find({
        createdByAgentId: agentObjectId,
        kycStatus: 'APPROVED',
        kycApprovedAt: { $gte: since },
      })
        .populate('userId', 'firstName lastName')
        .sort({ kycApprovedAt: -1 })
        .limit(limit)
        .lean(),
      GiftTransaction.find({
        receiverId: { $in: ids },
        type: { $in: RECEIVED_GIFT_TYPES },
        status: 'SUCCESS',
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      CommunicationSession.find({
        listenerId: { $in: ids },
        status: 'COMPLETED',
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Withdrawal.find({
        userId: { $in: ids },
        createdAt: { $gte: since },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const userIds = [...new Set(listenerIds.map((id) => id.toString()))];
    const users = await User.find({ _id: { $in: toObjectIds(userIds) } })
      .select('firstName lastName')
      .lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const nameOf = (userId) => {
      const u = userMap.get(userId?.toString());
      return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Listener';
    };

    const events = [];

    for (const p of approvals) {
      const uid = p.userId?._id?.toString() || p.userId?.toString();
      events.push({
        id: `reg-${p._id}`,
        type: 'register',
        text: `New listener ${nameOf(uid)} registered`,
        createdAt: p.kycApprovedAt || p.createdAt,
      });
    }

    for (const g of gifts) {
      events.push({
        id: `gift-${g._id}`,
        type: 'gift',
        text: `${nameOf(g.receiverId)} received a gift`,
        createdAt: g.createdAt,
      });
    }

    for (const s of sessions) {
      events.push({
        id: `rev-${s._id}`,
        type: 'revenue',
        text: `Revenue generated · ${s.totalCoinsEarned || 0} coins`,
        createdAt: s.createdAt,
      });
    }

    for (const w of withdrawals) {
      events.push({
        id: `wd-${w._id}`,
        type: 'withdraw',
        text: `Withdrawal requested · ${w.coinsRequested || 0} coins`,
        createdAt: w.createdAt,
      });
    }

    events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const docs = events.slice(0, limit);

    return {
      docs,
      meta: { hasMore: events.length > limit, nextCursor: events.length > limit ? String(limit) : null },
    };
  }

  async getAgentIdForListener(listenerUserId) {
    const profile = await ListenerProfile.findOne({ userId: listenerUserId }).select('createdByAgentId').lean();
    return profile?.createdByAgentId?.toString() || null;
  }
}

export default new AgentDashboardRepository();
