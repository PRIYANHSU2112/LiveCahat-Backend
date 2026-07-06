import mongoose from 'mongoose';
import User from '../modules/user.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import UserReport from '../modules/user-report.model.js';

const MS_DAY = 24 * 60 * 60 * 1000;

const customerIdsPipeline = [
  { $match: { type: 'CUSTOMER', isDeleted: false } },
  { $project: { _id: 1 } },
];

class UserActivityRepository {
  async getCustomerIds() {
    const rows = await User.find({ type: 'CUSTOMER', isDeleted: false }).select('_id').lean();
    return rows.map((r) => r._id);
  }

  async getCustomerActivityStats(boundaries) {
    const { now, startOfToday } = boundaries;
    const last24h = new Date(now.getTime() - MS_DAY);

    const [userFacet, suspicious] = await Promise.all([
      User.aggregate([
        { $match: { type: 'CUSTOMER', isDeleted: false } },
        {
          $facet: {
            activeNow: [{ $match: { isOnline: true } }, { $count: 'n' }],
            active24h: [{ $match: { lastSeen: { $gte: last24h } } }, { $count: 'n' }],
            newDevices24h: [
              {
                $match: {
                  deviceId: { $exists: true, $nin: [null, ''] },
                  createdAt: { $gte: last24h },
                },
              },
              { $count: 'n' },
            ],
          },
        },
      ]),
      UserReport.aggregate([
        {
          $match: {
            status: 'OPEN',
            targetType: 'CUSTOMER',
            $expr: { $gte: [{ $size: '$reasonIds' }, 2] },
          },
        },
        { $count: 'n' },
      ]),
    ]);

    const facet = userFacet[0] || {};
    const pick = (key) => facet[key]?.[0]?.n ?? 0;

    return {
      activeNow: pick('activeNow'),
      active24h: pick('active24h'),
      suspicious: suspicious[0]?.n ?? 0,
      newDevices24h: pick('newDevices24h'),
    };
  }

  /**
   * Unified customer activity feed (coin tx, sessions as caller, gifts sent).
   */
  async getCustomerActivityFeed(skip, limit) {
    const customerIds = await this.getCustomerIds();
    if (!customerIds.length) {
      return { total: 0, docs: [] };
    }

    const ids = customerIds.map((id) => new mongoose.Types.ObjectId(id));

    const [coinEvents, sessionEvents, giftEvents] = await Promise.all([
      CoinTransaction.aggregate([
        { $match: { userId: { $in: ids } } },
        {
          $project: {
            userId: 1,
            action: {
              $concat: ['Wallet · ', { $ifNull: ['$description', '$referenceType'] }],
            },
            occurredAt: '$createdAt',
            kind: { $literal: 'coin' },
          },
        },
        { $sort: { occurredAt: -1 } },
        { $limit: 200 },
      ]),
      CommunicationSession.aggregate([
        { $match: { callerId: { $in: ids } } },
        {
          $lookup: {
            from: 'users',
            localField: 'listenerId',
            foreignField: '_id',
            as: 'listener',
          },
        },
        {
          $project: {
            userId: '$callerId',
            action: {
              $concat: [
                'Session ',
                { $ifNull: ['$status', ''] },
                ' · listener ',
                {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: [{ $arrayElemAt: ['$listener.firstName', 0] }, ''] },
                        ' ',
                        { $ifNull: [{ $arrayElemAt: ['$listener.lastName', 0] }, ''] },
                      ],
                    },
                  },
                },
              ],
            },
            occurredAt: { $ifNull: ['$startTime', '$createdAt'] },
            kind: { $literal: 'session' },
          },
        },
        { $sort: { occurredAt: -1 } },
        { $limit: 200 },
      ]),
      GiftTransaction.aggregate([
        { $match: { senderId: { $in: ids }, type: 'USER_TO_LISTENER' } },
        {
          $project: {
            userId: '$senderId',
            action: { $concat: ['Sent gift · ', { $toString: '$coins' }, ' coins'] },
            occurredAt: '$createdAt',
            kind: { $literal: 'gift' },
          },
        },
        { $sort: { occurredAt: -1 } },
        { $limit: 200 },
      ]),
    ]);

    const merged = [...coinEvents, ...sessionEvents, ...giftEvents].sort(
      (a, b) => new Date(b.occurredAt) - new Date(a.occurredAt),
    );

    const total = merged.length;
    const page = merged.slice(skip, skip + limit);

    const userObjectIds = [...new Set(page.map((e) => e.userId.toString()))].map(
      (id) => new mongoose.Types.ObjectId(id),
    );
    const users = await User.find({ _id: { $in: userObjectIds } })
      .select('firstName lastName email mobileNumber')
      .lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const docs = page.map((e) => {
      const u = userMap.get(e.userId.toString());
      const name = u
        ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Customer'
        : 'Customer';
      return {
        id: `${e.kind}-${e.userId}-${new Date(e.occurredAt).getTime()}`,
        userId: e.userId.toString(),
        userName: name,
        action: e.action,
        device: null,
        ip: null,
        occurredAt: e.occurredAt,
      };
    });

    return { total, docs };
  }
}

export default new UserActivityRepository();
