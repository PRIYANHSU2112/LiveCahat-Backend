import CommunicationSession from '../modules/communication-session.model.js';
import SessionSegment from '../modules/session-segment.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import PaymentTransaction from '../modules/payment-transaction.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import User from '../modules/user.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECEIVED_GIFT_TYPES = ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'];
const ENDED_STATUSES = ['COMPLETED', 'MISSED', 'REJECTED', 'FAILED'];
const HOURLY_BUCKET_LABELS = ['00h', '04h', '08h', '12h', '16h', '20h'];
const CUSTOMER_BASE = { type: 'CUSTOMER', isDeleted: false };

const periodMatch = (start, end) => ({ createdAt: { $gte: start, $lte: end } });

const firstFacet = (row, key) => row?.[key]?.[0] ?? {};

const facetCount = (row, key) => row?.[key]?.[0]?.n ?? 0;

const daysInRange = (start, end) =>
  Math.max(1, Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY));

const approvedAtOrBefore = (rangeEnd) => ({
  kycStatus: 'APPROVED',
  $or: [{ kycApprovedAt: { $lte: rangeEnd } }, { kycApprovedAt: null, createdAt: { $lte: rangeEnd } }],
});

const approvedInRange = (start, end) => ({
  kycStatus: 'APPROVED',
  $or: [
    { kycApprovedAt: { $gte: start, $lte: end } },
    { kycApprovedAt: null, createdAt: { $gte: start, $lte: end } },
  ],
});

const buildGroupId = (granularity) => {
  if (granularity === 'hourly') {
    return {
      $floor: {
        $divide: [{ $hour: { date: '$createdAt', timezone: DASHBOARD_TZ } }, 4],
      },
    };
  }
  if (granularity === 'monthly') {
    return {
      $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: DASHBOARD_TZ },
    };
  }
  if (granularity === 'weekly') {
    return {
      $dateToString: { format: '%G-W%V', date: '$createdAt', timezone: DASHBOARD_TZ },
    };
  }
  return {
    $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: DASHBOARD_TZ },
  };
};

const mergeIdSets = (...groups) => {
  const set = new Set();
  for (const group of groups) {
    for (const row of group ?? []) {
      if (row?._id) set.add(row._id.toString());
    }
  }
  return set.size;
};

const formatPeakHour = (rows) => {
  if (!rows?.length) return { label: null, count: 0 };
  const hour = rows[0]._id;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return { label: `${h12} ${suffix}`, count: rows[0].count ?? 0 };
};

const sessionPeriodFacet = (start, end) => [
  { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
  {
    $group: {
      _id: null,
      gross: { $sum: '$totalCoinsSpent' },
      platform: { $sum: { $subtract: ['$totalCoinsSpent', '$totalCoinsEarned'] } },
    },
  },
];

const giftPeriodFacet = (start, end) => [
  { $match: { status: 'SUCCESS', ...periodMatch(start, end) } },
  {
    $group: {
      _id: null,
      gross: { $sum: '$coins' },
      platform: { $sum: '$adminCoins' },
    },
  },
];

class AdminAnalyticsRepository {
  async getRevenuePeriodTotals(start, end, previousStart, previousEnd) {
    const [sessionFacet, giftFacet, paymentFacet, bonusFacet] = await Promise.all([
      CommunicationSession.aggregate([
        {
          $facet: {
            current: sessionPeriodFacet(start, end),
            previous: sessionPeriodFacet(previousStart, previousEnd),
          },
        },
      ]).allowDiskUse(false),
      GiftTransaction.aggregate([
        {
          $facet: {
            current: giftPeriodFacet(start, end),
            previous: giftPeriodFacet(previousStart, previousEnd),
          },
        },
      ]).allowDiskUse(false),
      PaymentTransaction.aggregate([
        {
          $facet: {
            current: [
              { $match: { status: 'SUCCESS', ...periodMatch(start, end) } },
              { $group: { _id: null, amount: { $sum: '$amount' } } },
            ],
            previous: [
              { $match: { status: 'SUCCESS', ...periodMatch(previousStart, previousEnd) } },
              { $group: { _id: null, amount: { $sum: '$amount' } } },
            ],
          },
        },
      ]).allowDiskUse(false),
      CoinTransaction.aggregate([
        {
          $facet: {
            current: [
              {
                $match: {
                  type: 'CREDIT',
                  referenceType: { $in: ['BONUS', 'REFUND'] },
                  ...periodMatch(start, end),
                },
              },
              { $group: { _id: null, volume: { $sum: '$amount' } } },
            ],
            previous: [
              {
                $match: {
                  type: 'CREDIT',
                  referenceType: { $in: ['BONUS', 'REFUND'] },
                  ...periodMatch(previousStart, previousEnd),
                },
              },
              { $group: { _id: null, volume: { $sum: '$amount' } } },
            ],
          },
        },
      ]).allowDiskUse(false),
    ]);

    const merge = (curS, curG, curP, curB) => ({
      platformRevenue: (curS.platform ?? 0) + (curG.platform ?? 0),
      grossCoinVolume: (curS.gross ?? 0) + (curG.gross ?? 0),
      topUpInr: curP.amount ?? 0,
      otherCoins: curB.volume ?? 0,
      sessionGross: curS.gross ?? 0,
      giftGross: curG.gross ?? 0,
    });

    const sRow = sessionFacet[0] ?? {};
    const gRow = giftFacet[0] ?? {};
    const pRow = paymentFacet[0] ?? {};
    const bRow = bonusFacet[0] ?? {};

    return {
      current: merge(
        firstFacet(sRow, 'current'),
        firstFacet(gRow, 'current'),
        firstFacet(pRow, 'current'),
        firstFacet(bRow, 'current')
      ),
      previous: merge(
        firstFacet(sRow, 'previous'),
        firstFacet(gRow, 'previous'),
        firstFacet(pRow, 'previous'),
        firstFacet(bRow, 'previous')
      ),
    };
  }

  async getRevenueChartSeries(start, end, granularity) {
    const groupId = buildGroupId(granularity);
    const dateMatch = periodMatch(start, end);

    const [sessionRow, giftRow, paymentRow, bonusRow] = await Promise.all([
      CommunicationSession.aggregate([
        { $match: { status: 'COMPLETED', ...dateMatch } },
        {
          $facet: {
            series: [
              {
                $group: {
                  _id: groupId,
                  value: { $sum: { $subtract: ['$totalCoinsSpent', '$totalCoinsEarned'] } },
                },
              },
            ],
            totals: [{ $group: { _id: null, gross: { $sum: '$totalCoinsSpent' } } }],
          },
        },
      ]).allowDiskUse(false),
      GiftTransaction.aggregate([
        { $match: { status: 'SUCCESS', ...dateMatch } },
        {
          $facet: {
            series: [{ $group: { _id: groupId, value: { $sum: '$adminCoins' } } }],
            totals: [{ $group: { _id: null, gross: { $sum: '$coins' } } }],
          },
        },
      ]).allowDiskUse(false),
      PaymentTransaction.aggregate([
        { $match: { status: 'SUCCESS', ...dateMatch } },
        { $group: { _id: null, amount: { $sum: '$amount' } } },
      ]).allowDiskUse(false),
      CoinTransaction.aggregate([
        {
          $match: {
            type: 'CREDIT',
            referenceType: { $in: ['BONUS', 'REFUND'] },
            ...dateMatch,
          },
        },
        { $group: { _id: null, volume: { $sum: '$amount' } } },
      ]).allowDiskUse(false),
    ]);

    const merged = new Map();
    const sessionFacet = sessionRow[0] ?? {};
    const giftFacet = giftRow[0] ?? {};
    for (const row of [...(sessionFacet.series ?? []), ...(giftFacet.series ?? [])]) {
      const key = String(row._id);
      merged.set(key, (merged.get(key) || 0) + row.value);
    }

    const chartData = this._fillBuckets(start, end, granularity, merged);
    const sessionGross = sessionFacet.totals?.[0]?.gross ?? 0;
    const giftGross = giftFacet.totals?.[0]?.gross ?? 0;
    const topUpInr = paymentRow[0]?.amount ?? 0;
    const otherCoins = bonusRow[0]?.volume ?? 0;
    const totalCoins = sessionGross + giftGross || 1;

    const breakdown = [
      { label: 'Calls', value: sessionGross, pct: Math.round((sessionGross / totalCoins) * 1000) / 10 },
      { label: 'Gifts', value: giftGross, pct: Math.round((giftGross / totalCoins) * 1000) / 10 },
      { label: 'Coin Top-ups (INR)', value: topUpInr, pct: 0 },
      { label: 'Other', value: otherCoins, pct: Math.round((otherCoins / totalCoins) * 1000) / 10 },
    ].filter((row) => row.value > 0 || row.label === 'Calls' || row.label === 'Gifts');

    return { chartData, breakdown };
  }

  async getUserPeriodTotals(start, end, previousStart, previousEnd) {
    const inactiveCutoff = new Date(end.getTime() - 30 * MS_PER_DAY);
    const prevInactiveCutoff = new Date(previousEnd.getTime() - 30 * MS_PER_DAY);

    const inactiveMatch = (rangeEnd, cutoff) => ({
      ...CUSTOMER_BASE,
      createdAt: { $lte: rangeEnd },
      $or: [{ lastSeen: { $lt: cutoff } }, { lastSeen: null }],
      isOnline: { $ne: true },
    });

    const [totalCurrent, totalPrevious, newCurrent, newPrevious, inactiveCurrent, inactivePrevious, userActiveRow, sessionActiveRow] =
      await Promise.all([
      User.countDocuments({ ...CUSTOMER_BASE, createdAt: { $lte: end } }),
      User.countDocuments({ ...CUSTOMER_BASE, createdAt: { $lte: previousEnd } }),
      User.countDocuments({ ...CUSTOMER_BASE, createdAt: { $gte: start, $lte: end } }),
      User.countDocuments({
        ...CUSTOMER_BASE,
        createdAt: { $gte: previousStart, $lte: previousEnd },
      }),
      User.countDocuments(inactiveMatch(end, inactiveCutoff)),
      User.countDocuments(inactiveMatch(previousEnd, prevInactiveCutoff)),
      User.aggregate([
        { $match: CUSTOMER_BASE },
        {
          $facet: {
            activeCurrentSeen: [
              { $match: { lastSeen: { $gte: start, $lte: end } } },
              { $group: { _id: '$_id' } },
            ],
            activePreviousSeen: [
              { $match: { lastSeen: { $gte: previousStart, $lte: previousEnd } } },
              { $group: { _id: '$_id' } },
            ],
            activeCurrentOnline: [
              { $match: { isOnline: true, updatedAt: { $gte: start, $lte: end } } },
              { $group: { _id: '$_id' } },
            ],
            activePreviousOnline: [
              {
                $match: {
                  isOnline: true,
                  updatedAt: { $gte: previousStart, $lte: previousEnd },
                },
              },
              { $group: { _id: '$_id' } },
            ],
          },
        },
      ]).allowDiskUse(false),
      CommunicationSession.aggregate([
        {
          $facet: {
            activeCurrent: [
              { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
              { $group: { _id: '$callerId' } },
            ],
            activePrevious: [
              {
                $match: {
                  status: 'COMPLETED',
                  ...periodMatch(previousStart, previousEnd),
                },
              },
              { $group: { _id: '$callerId' } },
            ],
          },
        },
      ]).allowDiskUse(false),
    ]);

    const userRow = userActiveRow[0] ?? {};
    const sessionRow = sessionActiveRow[0] ?? {};

    return {
      current: {
        totalUsers: totalCurrent,
        activeUsers: mergeIdSets(
          userRow.activeCurrentSeen,
          userRow.activeCurrentOnline,
          sessionRow.activeCurrent
        ),
        newSignups: newCurrent,
        inactiveUsers: inactiveCurrent,
      },
      previous: {
        totalUsers: totalPrevious,
        activeUsers: mergeIdSets(
          userRow.activePreviousSeen,
          userRow.activePreviousOnline,
          sessionRow.activePrevious
        ),
        newSignups: newPrevious,
        inactiveUsers: inactivePrevious,
      },
    };
  }

  async getUserChartSeries(start, end, granularity) {
    const groupId = buildGroupId(granularity);
    const dateMatch = periodMatch(start, end);

    const [registrations, activeSessions] = await Promise.all([
      User.aggregate([
        { $match: { ...CUSTOMER_BASE, ...dateMatch } },
        { $group: { _id: groupId, value: { $sum: 1 } } },
      ]).allowDiskUse(false),
      CommunicationSession.aggregate([
        { $match: { status: 'COMPLETED', ...dateMatch } },
        { $group: { _id: groupId, callers: { $addToSet: '$callerId' } } },
        { $project: { _id: 1, value: { $size: '$callers' } } },
      ]).allowDiskUse(false),
    ]);

    const regMap = new Map(registrations.map((r) => [String(r._id), r.value]));
    const actMap = new Map(activeSessions.map((r) => [String(r._id), r.value]));

    return this._fillBuckets(start, end, granularity, regMap).map((b) => ({
      name: b.name,
      value: b.value,
      value2: actMap.get(b.key) ?? 0,
    }));
  }

  async getListenerPeriodTotals(start, end, previousStart, previousEnd) {
    const [listenerRow, sessionRow, activeRow] = await Promise.all([
      ListenerProfile.aggregate([
        {
          $facet: {
            approvedCurrent: [{ $match: approvedAtOrBefore(end) }, { $count: 'n' }],
            approvedPrevious: [{ $match: approvedAtOrBefore(previousEnd) }, { $count: 'n' }],
            newCurrent: [{ $match: approvedInRange(start, end) }, { $count: 'n' }],
            newPrevious: [{ $match: approvedInRange(previousStart, previousEnd) }, { $count: 'n' }],
          },
        },
      ]).allowDiskUse(false),
      CommunicationSession.aggregate([
        {
          $facet: {
            sessionsCurrent: [
              { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
              { $count: 'n' },
            ],
            sessionsPrevious: [
              { $match: { status: 'COMPLETED', ...periodMatch(previousStart, previousEnd) } },
              { $count: 'n' },
            ],
          },
        },
      ]).allowDiskUse(false),
      this._activeListenerFacet(start, end, previousStart, previousEnd),
    ]);

    const lRow = listenerRow[0] ?? {};
    const sRow = sessionRow[0] ?? {};
    const days = daysInRange(start, end);
    const prevDays = daysInRange(previousStart, previousEnd);
    const sessionsCurrent = facetCount(sRow, 'sessionsCurrent');
    const sessionsPrevious = facetCount(sRow, 'sessionsPrevious');

    return {
      current: {
        approvedListeners: facetCount(lRow, 'approvedCurrent'),
        activeListeners: activeRow.current,
        avgSessionsPerDay: Math.round((sessionsCurrent / days) * 10) / 10,
        newListeners: facetCount(lRow, 'newCurrent'),
      },
      previous: {
        approvedListeners: facetCount(lRow, 'approvedPrevious'),
        activeListeners: activeRow.previous,
        avgSessionsPerDay: Math.round((sessionsPrevious / prevDays) * 10) / 10,
        newListeners: facetCount(lRow, 'newPrevious'),
      },
    };
  }

  async _activeListenerFacet(start, end, previousStart, previousEnd) {
    const [sessionFacet, giftFacet] = await Promise.all([
      CommunicationSession.aggregate([
        {
          $facet: {
            current: [
              { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
              { $group: { _id: '$listenerId' } },
            ],
            previous: [
              { $match: { status: 'COMPLETED', ...periodMatch(previousStart, previousEnd) } },
              { $group: { _id: '$listenerId' } },
            ],
          },
        },
      ]).allowDiskUse(false),
      GiftTransaction.aggregate([
        {
          $facet: {
            current: [
              {
                $match: {
                  type: { $in: RECEIVED_GIFT_TYPES },
                  status: 'SUCCESS',
                  ...periodMatch(start, end),
                },
              },
              { $group: { _id: '$receiverId' } },
            ],
            previous: [
              {
                $match: {
                  type: { $in: RECEIVED_GIFT_TYPES },
                  status: 'SUCCESS',
                  ...periodMatch(previousStart, previousEnd),
                },
              },
              { $group: { _id: '$receiverId' } },
            ],
          },
        },
      ]).allowDiskUse(false),
    ]);

    const s = sessionFacet[0] ?? {};
    const g = giftFacet[0] ?? {};
    return {
      current: mergeIdSets(s.current, g.current),
      previous: mergeIdSets(s.previous, g.previous),
    };
  }

  async getListenerChartSeries(start, end, granularity) {
    const groupId = buildGroupId(granularity);
    const sessions = await CommunicationSession.aggregate([
      { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
      { $group: { _id: groupId, value: { $sum: 1 } } },
    ]).allowDiskUse(false);

    const map = new Map(sessions.map((r) => [String(r._id), r.value]));
    return this._fillBuckets(start, end, granularity, map).map((b) => ({
      name: b.name,
      value: b.value,
    }));
  }

  async getSessionPeriodTotals(start, end, previousStart, previousEnd) {
    const peakPipeline = (rangeStart, rangeEnd) => [
      { $match: { status: 'COMPLETED', ...periodMatch(rangeStart, rangeEnd) } },
      {
        $group: {
          _id: { $hour: { date: '$createdAt', timezone: DASHBOARD_TZ } },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ];

    const [row] = await CommunicationSession.aggregate([
      {
        $facet: {
          completedCurrent: [
            { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                avgDuration: { $avg: '$duration' },
              },
            },
          ],
          completedPrevious: [
            { $match: { status: 'COMPLETED', ...periodMatch(previousStart, previousEnd) } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                avgDuration: { $avg: '$duration' },
              },
            },
          ],
          endedCurrent: [
            { $match: { status: { $in: ENDED_STATUSES }, ...periodMatch(start, end) } },
            { $count: 'n' },
          ],
          endedPrevious: [
            {
              $match: {
                status: { $in: ENDED_STATUSES },
                ...periodMatch(previousStart, previousEnd),
              },
            },
            { $count: 'n' },
          ],
          peakCurrent: peakPipeline(start, end),
          peakPrevious: peakPipeline(previousStart, previousEnd),
        },
      },
    ]).allowDiskUse(false);

    const facet = row ?? {};
    const cur = firstFacet(facet, 'completedCurrent');
    const prev = firstFacet(facet, 'completedPrevious');
    const endedCur = facetCount(facet, 'endedCurrent');
    const endedPrev = facetCount(facet, 'endedPrevious');

    const completionRate = (completed, ended) =>
      ended > 0 ? Math.round((completed / ended) * 1000) / 10 : 100;

    const peakCurrent = formatPeakHour(facet.peakCurrent);
    const peakPrevious = formatPeakHour(facet.peakPrevious);

    return {
      current: {
        completedSessions: cur.count ?? 0,
        avgDurationSeconds: cur.avgDuration ?? 0,
        completionRate: completionRate(cur.count ?? 0, endedCur),
        peakHour: peakCurrent.label,
        peakHourCount: peakCurrent.count,
      },
      previous: {
        completedSessions: prev.count ?? 0,
        avgDurationSeconds: prev.avgDuration ?? 0,
        completionRate: completionRate(prev.count ?? 0, endedPrev),
        peakHour: peakPrevious.label,
        peakHourCount: peakPrevious.count,
      },
    };
  }

  async getSessionChartSeries(start, end, granularity) {
    const groupId = buildGroupId(granularity);
    const dateMatch = periodMatch(start, end);

    const [sessions, segments] = await Promise.all([
      CommunicationSession.aggregate([
        { $match: { status: 'COMPLETED', ...dateMatch } },
        { $group: { _id: groupId, value: { $sum: 1 } } },
      ]).allowDiskUse(false),
      SessionSegment.aggregate([
        { $match: { status: 'COMPLETED', ...dateMatch } },
        { $group: { _id: '$mode', count: { $sum: 1 } } },
      ]).allowDiskUse(false),
    ]);

    const map = new Map(sessions.map((r) => [String(r._id), r.value]));
    const chartData = this._fillBuckets(start, end, granularity, map).map((b) => ({
      name: b.name,
      value: b.value,
    }));

    const totalSeg = segments.reduce((s, r) => s + r.count, 0) || 1;
    const modeLabel = { CHAT: 'Chat', AUDIO: 'Voice', VIDEO: 'Video' };
    const breakdown = segments.map((r) => ({
      label: modeLabel[r._id] ?? r._id,
      value: r.count,
      pct: Math.round((r.count / totalSeg) * 1000) / 10,
    }));

    return { chartData, breakdown };
  }

  _fillBuckets(start, end, granularity, valueMap) {
    if (granularity === 'hourly') {
      return HOURLY_BUCKET_LABELS.map((name, i) => ({
        key: String(i),
        name,
        value: valueMap.get(String(i)) ?? 0,
      }));
    }

    if (granularity === 'monthly') {
      const buckets = [];
      const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      while (cursor <= endMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
        buckets.push({
          key,
          name: cursor.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
          value: valueMap.get(key) ?? 0,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      return buckets;
    }

    if (granularity === 'weekly') {
      const buckets = [];
      const cursor = new Date(start);
      cursor.setUTCHours(0, 0, 0, 0);
      const endDay = new Date(end);
      endDay.setUTCHours(23, 59, 59, 999);

      while (cursor <= endDay) {
        const key = this._isoWeekKey(cursor);
        if (!buckets.some((b) => b.key === key)) {
          buckets.push({
            key,
            name: `W${key.split('-W')[1]}`,
            value: valueMap.get(key) ?? 0,
          });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }
      return buckets;
    }

    const buckets = [];
    const cursor = new Date(start);
    cursor.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setUTCHours(23, 59, 59, 999);

    while (cursor <= endDay) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
      buckets.push({
        key,
        name: cursor.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        value: valueMap.get(key) ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return buckets;
  }

  _isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
}

export default new AdminAnalyticsRepository();
