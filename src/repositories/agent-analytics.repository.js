import mongoose from 'mongoose';
import ListenerProfile from '../modules/listener-profile.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';

const RECEIVED_GIFT_TYPES = ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'];
const RETENTION_BUCKETS = [1, 7, 14, 30, 60, 90];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));

class AgentAnalyticsRepository {
  async getListenerIdsForAgent(agentId) {
    const profiles = await ListenerProfile.find({ createdByAgentId: agentId })
      .select('userId')
      .lean();
    return profiles.map((p) => p.userId.toString());
  }

  async sumEarningsInRange(listenerIds, start, end) {
    if (!listenerIds.length) {
      return { sessionCoins: 0, giftCoins: 0, total: 0 };
    }

    const ids = toObjectIds(listenerIds);
    const dateMatch = { createdAt: { $gte: start, $lte: end } };

    const [sessionRow, giftRow] = await Promise.all([
      CommunicationSession.aggregate([
        {
          $match: {
            listenerId: { $in: ids },
            status: 'COMPLETED',
            ...dateMatch,
          },
        },
        { $group: { _id: null, total: { $sum: '$totalCoinsEarned' } } },
      ]),
      GiftTransaction.aggregate([
        {
          $match: {
            receiverId: { $in: ids },
            type: { $in: RECEIVED_GIFT_TYPES },
            status: 'SUCCESS',
            ...dateMatch,
          },
        },
        { $group: { _id: null, total: { $sum: '$earningCoins' } } },
      ]),
    ]);

    const sessionCoins = sessionRow[0]?.total ?? 0;
    const giftCoins = giftRow[0]?.total ?? 0;
    return { sessionCoins, giftCoins, total: sessionCoins + giftCoins };
  }

  async countActiveListenersInRange(listenerIds, start, end) {
    if (!listenerIds.length) return 0;

    const ids = toObjectIds(listenerIds);
    const [sessionListeners, giftListeners] = await Promise.all([
      CommunicationSession.distinct('listenerId', {
        listenerId: { $in: ids },
        status: 'COMPLETED',
        createdAt: { $gte: start, $lte: end },
      }),
      GiftTransaction.distinct('receiverId', {
        receiverId: { $in: ids },
        type: { $in: RECEIVED_GIFT_TYPES },
        status: 'SUCCESS',
        createdAt: { $gte: start, $lte: end },
      }),
    ]);

    return new Set([
      ...sessionListeners.map((id) => id.toString()),
      ...giftListeners.map((id) => id.toString()),
    ]).size;
  }

  async getMonthlyEarningsSpark(listenerIds, months = 10) {
    if (!listenerIds.length) return Array(months).fill(0);

    const ids = toObjectIds(listenerIds);
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const [sessions, gifts] = await Promise.all([
      CommunicationSession.aggregate([
        {
          $match: {
            listenerId: { $in: ids },
            status: 'COMPLETED',
            createdAt: { $gte: start },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: DASHBOARD_TZ } },
            value: { $sum: '$totalCoinsEarned' },
          },
        },
      ]),
      GiftTransaction.aggregate([
        {
          $match: {
            receiverId: { $in: ids },
            type: { $in: RECEIVED_GIFT_TYPES },
            status: 'SUCCESS',
            createdAt: { $gte: start },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: DASHBOARD_TZ } },
            value: { $sum: '$earningCoins' },
          },
        },
      ]),
    ]);

    const merged = new Map();
    [...sessions, ...gifts].forEach((row) => {
      merged.set(row._id, (merged.get(row._id) || 0) + row.value);
    });

    const series = [];
    const cursor = new Date(start);
    for (let i = 0; i < months; i++) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      series.push(merged.get(key) || 0);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return series;
  }

  async getListenerSummary(agentId) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const now = new Date();
    const activeSince = new Date(now.getTime() - 30 * MS_PER_DAY);
    const churnThreshold = new Date(now.getTime() - 90 * MS_PER_DAY);

    const [result] = await ListenerProfile.aggregate([
      { $match: { createdByAgentId: agentObjectId } },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
            { $project: { isBlocked: 1 } },
          ],
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalListeners: { $sum: 1 },
                avgLevel: { $avg: '$anchorLevel' },
                approvedCount: {
                  $sum: { $cond: [{ $eq: ['$kycStatus', 'APPROVED'] }, 1, 0] },
                },
              },
            },
          ],
          activeApproved: [
            { $match: { kycStatus: 'APPROVED' } },
            {
              $lookup: {
                from: 'communicationsessions',
                let: { lid: '$userId' },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ['$listenerId', '$$lid'] },
                      status: 'COMPLETED',
                      createdAt: { $gte: activeSince },
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'recentSession',
              },
            },
            {
              $match: {
                $or: [
                  { recentSession: { $ne: [] } },
                  { availability: { $in: ['ONLINE', 'BUSY'] } },
                ],
              },
            },
            { $count: 'n' },
          ],
          churnedApproved: [
            { $match: { kycStatus: 'APPROVED' } },
            {
              $lookup: {
                from: 'communicationsessions',
                let: { lid: '$userId' },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ['$listenerId', '$$lid'] },
                      status: 'COMPLETED',
                      createdAt: { $gte: churnThreshold },
                    },
                  },
                  { $limit: 1 },
                ],
                as: 'recentSession',
              },
            },
            {
              $match: {
                $or: [{ 'user.isBlocked': true }, { recentSession: { $eq: [] } }],
              },
            },
            { $count: 'n' },
          ],
        },
      },
    ]);

    const totals = result?.totals?.[0] ?? {};
    const activeCount = result?.activeApproved?.[0]?.n ?? 0;
    const churnedCount = result?.churnedApproved?.[0]?.n ?? 0;
    const approvedCount = totals.approvedCount ?? 0;

    return {
      totalListeners: totals.totalListeners ?? 0,
      avgLevel: totals.avgLevel ?? 0,
      approvedCount,
      activeCount,
      activeRatePct: approvedCount ? (activeCount / approvedCount) * 100 : 0,
      churnRatePct: approvedCount ? (churnedCount / approvedCount) * 100 : 0,
    };
  }

  async getListenerGrowthSeries(agentId, months = 6) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const series = [];
    const cursor = new Date(start);
    const listenerIds = await ListenerProfile.find({ createdByAgentId: agentObjectId })
      .select('userId')
      .lean()
      .then((rows) => rows.map((r) => r.userId.toString()));

    for (let i = 0; i < months; i++) {
      const monthStart = new Date(cursor);
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);

      const [totalApproved, activeCount] = await Promise.all([
        ListenerProfile.countDocuments({
          createdByAgentId: agentObjectId,
          kycStatus: 'APPROVED',
          $or: [
            { kycApprovedAt: { $lte: monthEnd } },
            { kycApprovedAt: null, createdAt: { $lte: monthEnd } },
          ],
        }),
        this._countActiveListenersInMonth(listenerIds, monthStart, monthEnd),
      ]);

      series.push({
        name: monthStart.toLocaleString('en-US', { month: 'short', timeZone: DASHBOARD_TZ }),
        value: totalApproved,
        value2: activeCount,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return series;
  }

  async _countActiveListenersInMonth(listenerIds, monthStart, monthEnd) {
    if (!listenerIds.length) return 0;
    const ids = toObjectIds(listenerIds);
    const active = await CommunicationSession.distinct('listenerId', {
      listenerId: { $in: ids },
      status: 'COMPLETED',
      createdAt: { $gte: monthStart, $lte: monthEnd },
    });
    return active.length;
  }

  async getRetentionSummary(agentId) {
    const cohort = await this._getCohortProfiles(agentId, 12);
    if (!cohort.length) {
      return {
        retention30Pct: 0,
        retention90Pct: 0,
        repeatRatePct: 0,
        churnRatePct: 0,
      };
    }

    const listenerIds = cohort.map((p) => p.userId);
    const sessions = await CommunicationSession.find({
      listenerId: { $in: toObjectIds(listenerIds.map((id) => id.toString())) },
      status: 'COMPLETED',
    })
      .select('listenerId createdAt')
      .lean();

    const sessionsByListener = new Map();
    for (const s of sessions) {
      const key = s.listenerId.toString();
      if (!sessionsByListener.has(key)) sessionsByListener.set(key, []);
      sessionsByListener.get(key).push(new Date(s.createdAt).getTime());
    }

    const now = Date.now();
    const retention30Pct = this._calcWindowRetentionPct(cohort, sessionsByListener, 30, now);
    const retention90Pct = this._calcWindowRetentionPct(cohort, sessionsByListener, 90, now);
    const repeatCount = [...sessionsByListener.values()].filter((times) => times.length >= 2).length;
    const repeatRatePct = cohort.length ? Math.round((repeatCount / cohort.length) * 1000) / 10 : 0;

    const listenerSummary = await this.getListenerSummary(agentId);

    return {
      retention30Pct,
      retention90Pct,
      repeatRatePct,
      churnRatePct: Math.round(listenerSummary.churnRatePct * 10) / 10,
    };
  }

  async getRetentionCurve(agentId, cohortMonths = 6) {
    const cohort = await this._getCohortProfiles(agentId, cohortMonths);
    if (!cohort.length) {
      return RETENTION_BUCKETS.map((n) => ({ name: `D${n}`, value: 0 }));
    }

    const listenerIds = cohort.map((p) => p.userId);
    const sessions = await CommunicationSession.find({
      listenerId: { $in: toObjectIds(listenerIds.map((id) => id.toString())) },
      status: 'COMPLETED',
    })
      .select('listenerId createdAt')
      .lean();

    const sessionsByListener = new Map();
    for (const s of sessions) {
      const key = s.listenerId.toString();
      if (!sessionsByListener.has(key)) sessionsByListener.set(key, []);
      sessionsByListener.get(key).push(new Date(s.createdAt).getTime());
    }

    const now = Date.now();
    return RETENTION_BUCKETS.map((days) => {
      const eligible = cohort.filter((p) => {
        const anchor = p.anchor.getTime();
        return now - anchor >= days * MS_PER_DAY;
      });

      if (!eligible.length) return { name: `D${days}`, value: 0 };

      let retained = 0;
      for (const profile of eligible) {
        const lid = profile.userId.toString();
        const anchor = profile.anchor.getTime();
        const windowEnd = anchor + days * MS_PER_DAY;
        const times = sessionsByListener.get(lid) || [];
        if (times.some((t) => t >= anchor && t <= windowEnd)) retained++;
      }

      return {
        name: `D${days}`,
        value: Math.round((retained / eligible.length) * 1000) / 10,
      };
    });
  }

  async _getCohortProfiles(agentId, cohortMonths) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const start = new Date();
    start.setMonth(start.getMonth() - cohortMonths);
    start.setHours(0, 0, 0, 0);

    const profiles = await ListenerProfile.find({
      createdByAgentId: agentObjectId,
      kycStatus: 'APPROVED',
      $or: [
        { kycApprovedAt: { $gte: start } },
        { kycApprovedAt: null, createdAt: { $gte: start } },
      ],
    })
      .select('userId kycApprovedAt createdAt')
      .lean();

    return profiles.map((p) => ({
      userId: p.userId,
      anchor: p.kycApprovedAt ? new Date(p.kycApprovedAt) : new Date(p.createdAt),
    }));
  }

  _calcWindowRetentionPct(cohort, sessionsByListener, days, now) {
    const eligible = cohort.filter((p) => now - p.anchor.getTime() >= days * MS_PER_DAY);
    if (!eligible.length) return 0;

    let retained = 0;
    for (const profile of eligible) {
      const lid = profile.userId.toString();
      const anchor = profile.anchor.getTime();
      const windowEnd = anchor + days * MS_PER_DAY;
      const times = sessionsByListener.get(lid) || [];
      if (times.some((t) => t >= anchor && t <= windowEnd)) retained++;
    }

    return Math.round((retained / eligible.length) * 1000) / 10;
  }

  /**
   * Earnings grouped by bucket key for period reports.
   * @param {'daily'|'weekly'|'monthly'} granularity
   * @returns {Map<string, number>} bucketKey → revenue coins
   */
  async getEarningsSeries(listenerIds, start, end, granularity) {
    if (!listenerIds.length) return new Map();

    const ids = toObjectIds(listenerIds);
    const dateMatch = { createdAt: { $gte: start, $lte: end } };

    let groupId;
    if (granularity === 'daily') {
      groupId = {
        $floor: {
          $divide: [{ $hour: { date: '$createdAt', timezone: DASHBOARD_TZ } }, 4],
        },
      };
    } else if (granularity === 'weekly') {
      groupId = {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: DASHBOARD_TZ },
      };
    } else {
      groupId = {
        $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: DASHBOARD_TZ },
      };
    }

    const [sessions, gifts] = await Promise.all([
      CommunicationSession.aggregate([
        {
          $match: {
            listenerId: { $in: ids },
            status: 'COMPLETED',
            ...dateMatch,
          },
        },
        { $group: { _id: groupId, value: { $sum: '$totalCoinsEarned' } } },
      ]),
      GiftTransaction.aggregate([
        {
          $match: {
            receiverId: { $in: ids },
            type: { $in: RECEIVED_GIFT_TYPES },
            status: 'SUCCESS',
            ...dateMatch,
          },
        },
        { $group: { _id: groupId, value: { $sum: '$earningCoins' } } },
      ]),
    ]);

    const merged = new Map();
    [...sessions, ...gifts].forEach((row) => {
      const key = String(row._id);
      merged.set(key, (merged.get(key) || 0) + row.value);
    });
    return merged;
  }

  async countNewListeners(agentId, start, end) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    return ListenerProfile.countDocuments({
      createdByAgentId: agentObjectId,
      kycStatus: 'APPROVED',
      $or: [
        { kycApprovedAt: { $gte: start, $lte: end } },
        { kycApprovedAt: null, createdAt: { $gte: start, $lte: end } },
      ],
    });
  }
}

export default new AgentAnalyticsRepository();
