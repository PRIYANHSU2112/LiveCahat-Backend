import mongoose from 'mongoose';
import ListenerProfile from '../modules/listener-profile.model.js';
import User from '../modules/user.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import Withdrawal from '../modules/withdrawal.model.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';

const RECEIVED_GIFT_TYPES = ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'];
const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));

class AgentRepository {
  async getListenerIdsForAgent(agentId) {
    const profiles = await ListenerProfile.find({ createdByAgentId: agentId })
      .select('userId')
      .lean();
    return profiles.map((p) => p.userId.toString());
  }

  async getAgentCommissionRate(agentId) {
    const user = await User.findById(agentId).select('commissionPercentage').lean();
    return user?.commissionPercentage ?? 0;
  }

  async sumEarnings(listenerIds, start, end) {
    if (!listenerIds.length) {
      return { sessionCoins: 0, giftCoins: 0, total: 0 };
    }

    const ids = toObjectIds(listenerIds);
    const dateMatch = start && end ? { createdAt: { $gte: start, $lte: end } } : {};

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

  async getWithdrawalTotals(agentId) {
    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const [paidRow, pendingRow] = await Promise.all([
      Withdrawal.aggregate([
        { $match: { userId: agentObjectId, status: 'APPROVED' } },
        { $group: { _id: null, coins: { $sum: '$coinsRequested' } } },
      ]),
      Withdrawal.aggregate([
        { $match: { userId: agentObjectId, status: 'PENDING' } },
        { $group: { _id: null, coins: { $sum: '$coinsRequested' } } },
      ]),
    ]);

    return {
      paidCoins: paidRow[0]?.coins ?? 0,
      pendingWithdrawalCoins: pendingRow[0]?.coins ?? 0,
    };
  }

  async getMonthlyRevenueSeries(listenerIds, months = 6) {
    if (!listenerIds.length) return [];

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
      const monthLabel = cursor.toLocaleString('en-US', { month: 'short', timeZone: DASHBOARD_TZ });
      series.push({ key, name: monthLabel, value: merged.get(key) || 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return series;
  }

  async getWeeklyCommissionSeries(listenerIds, weeks = 6) {
    if (!listenerIds.length) return [];

    const ids = toObjectIds(listenerIds);
    const start = new Date();
    start.setDate(start.getDate() - weeks * 7);
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
            _id: { $isoWeek: '$createdAt' },
            value: { $sum: '$totalCoinsEarned' },
            weekStart: { $min: '$createdAt' },
          },
        },
        { $sort: { weekStart: 1 } },
        { $limit: weeks },
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
            _id: { $isoWeek: '$createdAt' },
            value: { $sum: '$earningCoins' },
            weekStart: { $min: '$createdAt' },
          },
        },
      ]),
    ]);

    const merged = new Map();
    [...sessions, ...gifts].forEach((row) => {
      const key = String(row._id);
      const existing = merged.get(key) || { value: 0, weekStart: row.weekStart };
      merged.set(key, {
        value: existing.value + row.value,
        weekStart: existing.weekStart < row.weekStart ? existing.weekStart : row.weekStart,
      });
    });

    return [...merged.entries()]
      .sort((a, b) => a[1].weekStart - b[1].weekStart)
      .slice(-weeks)
      .map((entry, index) => ({
        name: `Week ${index + 1}`,
        commission: entry[1].value,
      }));
  }

  async getSourceBreakdown(listenerIds) {
    if (!listenerIds.length) {
      return { gifts: 0, calls: 0, total: 0 };
    }

    const { sessionCoins, giftCoins, total } = await this.sumEarnings(listenerIds);
    return { gifts: giftCoins, calls: sessionCoins, total };
  }

  _buildCommissionDateMatch(dateFrom, dateTo) {
    if (!dateFrom && !dateTo) return {};
    const createdAt = {};
    if (dateFrom) createdAt.$gte = new Date(dateFrom);
    if (dateTo) createdAt.$lte = new Date(dateTo);
    return { createdAt };
  }

  async getCommissionHistoryRows(listenerIds, { source = 'all', dateFrom, dateTo, search } = {}) {
    if (!listenerIds.length) return [];

    const ids = toObjectIds(listenerIds);
    const dateMatch = this._buildCommissionDateMatch(dateFrom, dateTo);

    const sessionStages = [
      {
        $match: {
          listenerId: { $in: ids },
          status: 'COMPLETED',
          ...dateMatch,
        },
      },
      {
        $project: {
          source: { $literal: 'Call' },
          listenerId: '$listenerId',
          amount: '$totalCoinsEarned',
          createdAt: 1,
          refId: '$_id',
        },
      },
    ];

    const giftStages = [
      {
        $match: {
          receiverId: { $in: ids },
          type: { $in: RECEIVED_GIFT_TYPES },
          status: 'SUCCESS',
          ...dateMatch,
        },
      },
      {
        $project: {
          source: { $literal: 'Gift' },
          listenerId: '$receiverId',
          amount: '$earningCoins',
          createdAt: 1,
          refId: '$_id',
        },
      },
    ];

    const lookupStages = [
      {
        $lookup: {
          from: 'users',
          localField: 'listenerId',
          foreignField: '_id',
          as: 'listenerUser',
        },
      },
      { $unwind: '$listenerUser' },
      {
        $addFields: {
          listenerName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$listenerUser.firstName', ''] },
                  ' ',
                  { $ifNull: ['$listenerUser.lastName', ''] },
                ],
              },
            },
          },
        },
      },
    ];

    if (search?.trim()) {
      lookupStages.push({
        $match: {
          listenerName: { $regex: search.trim(), $options: 'i' },
        },
      });
    }

    let pipeline;
    let model = CommunicationSession;

    if (source === 'gift') {
      model = GiftTransaction;
      pipeline = [...giftStages, ...lookupStages, { $sort: { createdAt: -1 } }];
    } else if (source === 'call') {
      pipeline = [...sessionStages, ...lookupStages, { $sort: { createdAt: -1 } }];
    } else {
      pipeline = [
        ...sessionStages,
        { $unionWith: { coll: 'gifttransactions', pipeline: giftStages } },
        ...lookupStages,
        { $sort: { createdAt: -1 } },
      ];
    }

    const rows = await model.aggregate(pipeline);

    return rows.map((row) => ({
      id: row.refId.toString(),
      source: row.source,
      listenerId: row.listenerId.toString(),
      listener: row.listenerName?.trim() || 'Listener',
      amount: row.amount ?? 0,
      date: row.createdAt,
    }));
  }
}

export default new AgentRepository();
