import mongoose from 'mongoose';
import BaseRepository from './base.repository.js';
import GiftTransaction from '../modules/gift-transaction.model.js';

const RECEIVED_GIFT_TYPES = ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'];

class GiftTransactionRepository extends BaseRepository {
  constructor() {
    super(GiftTransaction);
  }

  /**
   * Aggregate gifts a listener received within a date range.
   * Returns { giftCount, giftCoins } (earningCoins credited to the listener).
   * Uses the { receiverId, createdAt } compound index.
   */
  async getListenerGiftStats(receiverId, start, end) {
    const [row] = await this.aggregate([
      {
        $match: {
          receiverId: new mongoose.Types.ObjectId(receiverId),
          type: { $in: RECEIVED_GIFT_TYPES },
          status: 'SUCCESS',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          giftCount: { $sum: 1 },
          giftCoins: { $sum: '$earningCoins' },
        },
      },
    ]);
    return row || { giftCount: 0, giftCoins: 0 };
  }

  /**
   * Bucketed gift earnings for the growth chart.
   * Returns [{ _id: '<bucketLabel>', value }] where value = earningCoins.
   */
  async getGiftEarningsByBucket(receiverId, start, end, dateFormat, timezone) {
    return await this.aggregate([
      {
        $match: {
          receiverId: new mongoose.Types.ObjectId(receiverId),
          type: { $in: RECEIVED_GIFT_TYPES },
          status: 'SUCCESS',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone } },
          value: { $sum: '$earningCoins' },
        },
      },
    ]);
  }

  /**
   * Get paginated gift transactions with populated details.
   */
  async getPaginatedTransactions(matchQuery, sort, skip, limit) {
    const total = await this.model.countDocuments(matchQuery);
    const data = await this.model.find(matchQuery)
      .populate('giftId')
      .populate('senderId', 'firstName lastName profileImage type')
      .populate('receiverId', 'firstName lastName profileImage type')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
    return { total, data };
  }
}

export default new GiftTransactionRepository();
