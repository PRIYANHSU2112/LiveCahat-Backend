import User from '../modules/user.model.js';
import mongoose from 'mongoose';


const MS_DAY = 24 * 60 * 60 * 1000;

const countFromFacet = (facet, key) => facet?.[key]?.[0]?.n ?? 0;

class UserRepository {
  async create(data) {
    return await User.create(data);
  }

  async findById(id, select = '', populate = '', lean = true) {
    let query = User.findById(id).select(select).populate(populate);
    if (lean) query = query.lean();
    return await query;
  }

  async findOne(filter, select = '', populate = '', lean = true) {
    let query = User.findOne(filter).select(select).populate(populate);
    if (lean) query = query.lean();
    return await query;
  }

  async updateById(id, data, options = { new: true, runValidators: true }) {
    return await User.findByIdAndUpdate(id, data, options);
  }

  async deleteById(id) {
    return await User.findByIdAndDelete(id);
  }

  async softDeleteById(id) {
    return await User.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() }, { new: true });
  }

  async aggregate(pipeline) {
    return await User.aggregate(pipeline);
  }

  async findByEmail(email) {
    return await this.findOne({ email });
  }

  async findByMobile(mobileNumber) {
    return await this.findOne({ mobileNumber });
  }

  async findByDeviceId(deviceId) {
    return await this.findOne({ deviceId, isDeleted: false });
  }

  async getPaginatedUsers(matchQuery, sort, skip, limit) {
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
                from: 'wallets',
                localField: '_id',
                foreignField: 'userId',
                as: 'walletDoc',
              },
            },
            {
              $addFields: {
                wallet: {
                  $cond: {
                    if: { $gt: [{ $size: '$walletDoc' }, 0] },
                    then: { coinBalance: { $arrayElemAt: ['$walletDoc.coinBalance', 0] } },
                    else: null,
                  },
                },
              },
            },
            { $project: { walletDoc: 0 } },
          ],
        },
      },
    ];

    const result = await this.aggregate(pipeline);
    const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;
    const data = result[0].data;

    return { total, data };
  }

  async getCustomerAdminStats(boundaries) {
    const { now, startOfToday } = boundaries;
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_DAY);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * MS_DAY);
    const base = { type: 'CUSTOMER', isDeleted: false };

    const [row] = await this.aggregate([
      { $match: base },
      {
        $facet: {
          totalUsers: [{ $count: 'n' }],
          activeToday: [
            {
              $match: {
                $or: [{ lastSeen: { $gte: startOfToday } }, { isOnline: true }],
              },
            },
            { $count: 'n' },
          ],
          activeTodayPrevious: [
            {
              $match: {
                lastSeen: {
                  $gte: new Date(startOfToday.getTime() - MS_DAY),
                  $lt: startOfToday,
                },
              },
            },
            { $count: 'n' },
          ],
          new7d: [{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $count: 'n' }],
          new7dPrevious: [
            { $match: { createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
            { $count: 'n' },
          ],
          blocked: [{ $match: { isBlocked: true } }, { $count: 'n' }],
          blockedPrevious: [
            {
              $match: {
                isBlocked: true,
                blockedAt: { $ne: null, $lt: startOfToday },
              },
            },
            { $count: 'n' },
          ],
        },
      },
    ]);

    return {
      totalUsers: countFromFacet(row, 'totalUsers'),
      activeToday: countFromFacet(row, 'activeToday'),
      activeTodayPrevious: countFromFacet(row, 'activeTodayPrevious'),
      new7d: countFromFacet(row, 'new7d'),
      new7dPrevious: countFromFacet(row, 'new7dPrevious'),
      blocked: countFromFacet(row, 'blocked'),
      blockedPrevious: countFromFacet(row, 'blockedPrevious'),
    };
  }

  async getBlockedAccountStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_DAY);
    const base = { isDeleted: false, isBlocked: true };

    const [row] = await this.aggregate([
      { $match: base },
      {
        $facet: {
          totalBlocked: [{ $count: 'n' }],
          customers: [{ $match: { type: 'CUSTOMER' } }, { $count: 'n' }],
          agents: [{ $match: { type: 'AGENT' } }, { $count: 'n' }],
          listeners: [{ $match: { type: 'LISTENER' } }, { $count: 'n' }],
          blockedThisMonth: [{ $match: { blockedAt: { $gte: startOfMonth } } }, { $count: 'n' }],
          blockedLast7Days: [{ $match: { blockedAt: { $gte: sevenDaysAgo } } }, { $count: 'n' }],
        },
      },
    ]);

    return {
      totalBlocked: countFromFacet(row, 'totalBlocked'),
      customers: countFromFacet(row, 'customers'),
      agents: countFromFacet(row, 'agents'),
      listeners: countFromFacet(row, 'listeners'),
      blockedThisMonth: countFromFacet(row, 'blockedThisMonth'),
      blockedLast7Days: countFromFacet(row, 'blockedLast7Days'),
    };
  }

  async getCustomerVerificationStats(boundaries) {
    const { startOfToday, now } = boundaries;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_DAY);
    const base = { type: 'CUSTOMER', isDeleted: false };
    const pendingMatch = {
      ...base,
      $or: [{ ageVerified: false }, { profileCompleted: false }],
      isBlocked: false,
    };

    const [row, avgRow] = await Promise.all([
      this.aggregate([
        { $match: base },
        {
          $facet: {
            pending: [{ $match: pendingMatch }, { $count: 'n' }],
            approvedToday: [
              {
                $match: {
                  ageVerified: true,
                  profileCompleted: true,
                  updatedAt: { $gte: startOfToday },
                },
              },
              { $count: 'n' },
            ],
            approvedYesterday: [
              {
                $match: {
                  ageVerified: true,
                  profileCompleted: true,
                  updatedAt: {
                    $gte: new Date(startOfToday.getTime() - MS_DAY),
                    $lt: startOfToday,
                  },
                },
              },
              { $count: 'n' },
            ],
            rejected: [
              {
                $match: {
                  isBlocked: true,
                  $or: [{ ageVerified: false }, { profileCompleted: false }],
                },
              },
              { $count: 'n' },
            ],
            rejectedPrevious: [
              {
                $match: {
                  isBlocked: true,
                  blockedAt: { $ne: null, $lt: startOfToday },
                  $or: [{ ageVerified: false }, { profileCompleted: false }],
                },
              },
              { $count: 'n' },
            ],
          },
        },
      ]),
      this.aggregate([
        {
          $match: {
            ...base,
            profileCompleted: true,
            updatedAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: null,
            avgMinutes: {
              $avg: {
                $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 60000],
              },
            },
          },
        },
      ]),
    ]);

    const facet = row[0] || {};
    return {
      pending: countFromFacet(facet, 'pending'),
      approvedToday: countFromFacet(facet, 'approvedToday'),
      approvedYesterday: countFromFacet(facet, 'approvedYesterday'),
      rejected: countFromFacet(facet, 'rejected'),
      rejectedPrevious: countFromFacet(facet, 'rejectedPrevious'),
      avgReviewTimeMinutes: Math.round(avgRow[0]?.avgMinutes ?? 0),
    };
  }

  async getCustomerVerificationQueue(skip, limit) {
    const matchQuery = {
      type: 'CUSTOMER',
      isDeleted: false,
      isBlocked: false,
      $or: [{ ageVerified: false }, { profileCompleted: false }],
    };

    const pipeline = [
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const result = await this.aggregate(pipeline);
    const total = result[0].metadata[0]?.total ?? 0;
    const data = result[0].data ?? [];
    return { total, data };
  }

  async getAgentAdminStats(range = {}) {
    const ListenerProfile = mongoose.model('ListenerProfile');

    const [agentFacet, totalListeners] = await Promise.all([
      User.aggregate([
        { $match: { type: 'AGENT', isDeleted: false } },
        {
          $facet: {
            count: [{ $count: 'n' }],
            agents: [
              { $project: { _id: 1, commissionPercentage: 1 } },
            ],
            avgCommission: [
              { $group: { _id: null, avgCommission: { $avg: '$commissionPercentage' } } },
            ],
            earnings: [
              {
                $lookup: {
                  from: 'wallets',
                  localField: '_id',
                  foreignField: 'userId',
                  as: 'walletDoc',
                },
              },
              {
                $group: {
                  _id: null,
                  totalBalance: {
                    $sum: { $ifNull: [{ $arrayElemAt: ['$walletDoc.coinBalance', 0] }, 0] },
                  },
                },
              },
            ],
          },
        },
      ]),
      range.start && range.end
        ? ListenerProfile.countDocuments({
            createdByAgentId: { $ne: null },
            createdAt: { $gte: range.start, $lte: range.end },
          })
        : ListenerProfile.countDocuments({ createdByAgentId: { $ne: null } }),
    ]);

    const facet = agentFacet[0] ?? {};
    return {
      totalAgents: facet.count?.[0]?.n ?? 0,
      agents: facet.agents ?? [],
      totalListeners,
      averageCommission: facet.avgCommission?.[0]?.avgCommission ?? 0,
      totalWalletBalance: facet.earnings?.[0]?.totalBalance ?? 0,
    };
  }
}

export default new UserRepository();
