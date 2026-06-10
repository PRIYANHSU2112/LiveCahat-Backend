import BaseRepository from './base.repository.js';
import CoinTransaction from '../modules/coin-transaction.model.js';

class CoinTransactionRepository extends BaseRepository {
  constructor() {
    super(CoinTransaction);
  }

  async getPaginatedTransactions(matchQuery, sort, skip, limit) {
    const pipeline = [
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
                localField: 'userId',
                foreignField: '_id',
                as: 'user'
              }
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                'user.password': 0,
                'user.refreshToken': 0
              }
            }
          ]
        }
      }
    ];

    const result = await this.aggregate(pipeline);
    const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;
    const data = result[0].data;

    return { total, data };
  }
}

export default new CoinTransactionRepository();
