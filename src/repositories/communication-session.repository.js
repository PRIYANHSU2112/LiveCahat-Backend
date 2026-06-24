import mongoose from 'mongoose';
import BaseRepository from './base.repository.js';
import CommunicationSession from '../modules/communication-session.model.js';

class CommunicationSessionRepository extends BaseRepository {
  constructor() {
    super(CommunicationSession);
  }

  /**
   * Find any ongoing session for a given user (either caller or listener).
   */
  async findActiveByUserId(userId) {
    return await this.findOne({
      $or: [{ callerId: userId }, { listenerId: userId }],
      status: 'ONGOING',
    });
  }

  /**
   * Aggregate a listener's completed-session stats within a date range.
   * Returns { earnedCoins, totalSeconds, sessionCount } (zeros when none).
   * Uses the { listenerId, createdAt } compound index.
   */
  async getListenerStats(listenerId, start, end) {
    const [row] = await this.aggregate([
      {
        $match: {
          listenerId: new mongoose.Types.ObjectId(listenerId),
          status: 'COMPLETED',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          earnedCoins: { $sum: '$totalCoinsEarned' },
          totalSeconds: { $sum: '$duration' },
          sessionCount: { $sum: 1 },
        },
      },
    ]);
    return row || { earnedCoins: 0, totalSeconds: 0, sessionCount: 0 };
  }

  /**
   * Bucketed session earnings for the growth chart.
   * Returns [{ _id: '<bucketLabel>', value }] where value = coins earned.
   */
  async getEarningsByBucket(listenerId, start, end, dateFormat, timezone) {
    return await this.aggregate([
      {
        $match: {
          listenerId: new mongoose.Types.ObjectId(listenerId),
          status: 'COMPLETED',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone } },
          value: { $sum: '$totalCoinsEarned' },
        },
      },
    ]);
  }

  /**
   * Paginated recent sessions for a listener (single round-trip count + data).
   * Mirrors wallet.repository.getPaginatedWallets.
   */
  async getPaginatedListenerSessions(matchQuery, sort, skip, limit) {
    const [result] = await this.aggregate([
      { $match: matchQuery },
      { $sort: sort },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: 'callerId',
                foreignField: '_id',
                as: 'caller',
                pipeline: [{ $project: { firstName: 1, lastName: 1, profileImage: 1 } }],
              },
            },
            { $unwind: { path: '$caller', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                callerId: 1,
                caller: 1,
                startTime: 1,
                endTime: 1,
                duration: 1,
                status: 1,
                totalCoinsEarned: 1,
                rating: 1,
                createdAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const total = result.metadata[0] ? result.metadata[0].total : 0;
    return { total, data: result.data };
  }
}

export default new CommunicationSessionRepository();
