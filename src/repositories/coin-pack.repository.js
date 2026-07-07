import BaseRepository from './base.repository.js';
import CoinPack from '../modules/coin-pack.model.js';

class CoinPackRepository extends BaseRepository {
  constructor() {
    super(CoinPack);
  }

  async findAdminPaginated(filter, sort, skip, limit) {
    const [docs, total] = await Promise.all([
      this.findMany(filter, '', '', sort, limit, skip),
      this.countDocuments(filter),
    ]);
    return { docs, total };
  }

  async getAdminStats() {
    const [total, active, inactive, aggregates] = await Promise.all([
      this.countDocuments({}),
      this.countDocuments({ isActive: true }),
      this.countDocuments({ isActive: false }),
      this.aggregate([
        {
          $group: {
            _id: null,
            totalCoinsOffered: { $sum: '$coins' },
            avgPrice: { $avg: '$price' },
          },
        },
      ]),
    ]);

    const agg = aggregates[0] || { totalCoinsOffered: 0, avgPrice: 0 };

    return {
      total,
      active,
      inactive,
      totalCoinsOffered: agg.totalCoinsOffered ?? 0,
      avgPrice: Number((agg.avgPrice ?? 0).toFixed(2)),
    };
  }
}

export default new CoinPackRepository();
