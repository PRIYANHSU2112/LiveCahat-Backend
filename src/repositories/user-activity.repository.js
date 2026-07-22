import mongoose from 'mongoose';
import User from '../modules/user.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import GiftTransaction from '../modules/gift-transaction.model.js';
import UserReport from '../modules/user-report.model.js';

const MS_DAY = 24 * 60 * 60 * 1000;
const FEED_LOOKBACK_DAYS = 90;
const FEED_SOURCE_LIMIT = 200;

const customerUserLookup = (localField) => ({
  $lookup: {
    from: 'users',
    localField,
    foreignField: '_id',
    as: 'customer',
    pipeline: [
      { $match: { type: 'CUSTOMER', isDeleted: false } },
      { $project: { firstName: 1, lastName: 1, email: 1, mobileNumber: 1 } },
    ],
  },
});

class UserActivityRepository {
  async getCustomerIds() {
    const rows = await User.find({ type: 'CUSTOMER', isDeleted: false }).select('_id').lean();
    return rows.map((r) => r._id);
  }

  async getCustomerActivityStats(boundaries) {
    const { now } = boundaries;
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
   * Filters customers via $lookup instead of loading all customer IDs into $in.
   */
  async getCustomerActivityFeed(skip, limit) {
    const since = new Date(Date.now() - FEED_LOOKBACK_DAYS * MS_DAY);

    const [coinEvents, sessionEvents, giftEvents] = await Promise.all([
      CoinTransaction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        { $limit: FEED_SOURCE_LIMIT * 5 },
        customerUserLookup('userId'),
        { $match: { 'customer.0': { $exists: true } } },
        { $limit: FEED_SOURCE_LIMIT },
        {
          $project: {
            userId: 1,
            action: {
              $concat: ['Wallet · ', { $ifNull: ['$description', '$referenceType'] }],
            },
            occurredAt: '$createdAt',
            kind: { $literal: 'coin' },
            customer: { $arrayElemAt: ['$customer', 0] },
          },
        },
      ]),
      CommunicationSession.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        { $limit: FEED_SOURCE_LIMIT * 5 },
        customerUserLookup('callerId'),
        { $match: { 'customer.0': { $exists: true } } },
        { $limit: FEED_SOURCE_LIMIT },
        {
          $lookup: {
            from: 'users',
            localField: 'listenerId',
            foreignField: '_id',
            as: 'listener',
            pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
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
            customer: { $arrayElemAt: ['$customer', 0] },
          },
        },
      ]),
      GiftTransaction.aggregate([
        {
          $match: {
            senderId: { $exists: true },
            type: 'USER_TO_LISTENER',
            createdAt: { $gte: since },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: FEED_SOURCE_LIMIT * 5 },
        customerUserLookup('senderId'),
        { $match: { 'customer.0': { $exists: true } } },
        { $limit: FEED_SOURCE_LIMIT },
        {
          $project: {
            userId: '$senderId',
            action: { $concat: ['Sent gift · ', { $toString: '$coins' }, ' coins'] },
            occurredAt: '$createdAt',
            kind: { $literal: 'gift' },
            customer: { $arrayElemAt: ['$customer', 0] },
          },
        },
      ]),
    ]);

    const merged = [...coinEvents, ...sessionEvents, ...giftEvents].sort(
      (a, b) => new Date(b.occurredAt) - new Date(a.occurredAt),
    );

    const total = merged.length;
    const page = merged.slice(skip, skip + limit);

    const docs = page.map((e) => {
      const u = e.customer;
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
