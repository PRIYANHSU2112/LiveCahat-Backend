import ListenerProfile from '../modules/listener-profile.model.js';

class ListenerRepository {
  async create(data) {
    return await ListenerProfile.create(data);
  }

  async findById(id, select = '', populate = '', lean = true) {
    let query = ListenerProfile.findById(id).select(select).populate(populate);
    if (lean) query = query.lean();
    return await query;
  }

  async findOne(filter, select = '', populate = '', lean = true) {
    let query = ListenerProfile.findOne(filter).select(select).populate(populate);
    if (lean) query = query.lean();
    return await query;
  }

  async updateById(id, data, options = { new: true, runValidators: true }) {
    return await ListenerProfile.findByIdAndUpdate(id, data, options);
  }

  async deleteById(id) {
    return await ListenerProfile.findByIdAndDelete(id);
  }

  async aggregate(pipeline) {
    return await ListenerProfile.aggregate(pipeline);
  }

  async findByUserId(userId) {
    return await this.findOne({ userId }, '', [{ path: 'userId', select: 'firstName lastName email profileImage isOnline' }]);
  }

  /**
   * USER HOME FEED — paginated listing of active listeners with search + filters.
   *
   * @param {Object} profileMatch  Match stage on the listener profile (kycStatus, availability, languages, avgRating...)
   * @param {Object} userMatch     Match stage on the joined user (isDeleted, isBlocked, countryCode, name search)
   * @param {Object} sort          Sort spec (e.g. { isFeatured: -1, followersCount: -1 })
   * @param {Number} skip
   * @param {Number} limit
   * @returns {{ total: Number, data: Array }}
   */
  async getHomeListeners(profileMatch, userMatch, sort, skip, limit) {
    const pipeline = [
      // 1. Narrow on the indexed profile fields first (kycStatus/availability/language/rating).
      { $match: profileMatch },
      // 2. Join the owning user and apply the active/blocked/country/search filters.
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $match: userMatch },
      // 3. Resolve language references for display.
      {
        $lookup: {
          from: 'languages',
          localField: 'languages',
          foreignField: '_id',
          as: 'languageDetails',
        },
      },
      // 3b. Resolve the country reference for display.
      {
        $lookup: {
          from: 'countries',
          localField: 'country',
          foreignField: '_id',
          as: 'countryDetails',
        },
      },
      { $unwind: { path: '$countryDetails', preserveNullAndEmptyArrays: true } },
      // 4. Return only what the home card needs (keeps payload small + fast).
      {
        $project: {
          _id: 1,
          userId: 1,
          bio: 1,
          profilePhotos: 1,
          categories: 1,
          chatRate: 1,
          voiceRate: 1,
          videoRate: 1,
          avgRating: 1,
          totalRatings: 1,
          totalSessions: 1,
          availability: 1,
          isFeatured: 1,
          followersCount: 1,
          anchorLevel: 1,
          'languageDetails._id': 1,
          'languageDetails.name': 1,
          'languageDetails.code': 1,
          'languageDetails.flagUrl': 1,
          'countryDetails._id': 1,
          'countryDetails.name': 1,
          'countryDetails.code': 1,
          'countryDetails.dialCode': 1,
          'countryDetails.flagUrl': 1,
          'user._id': 1,
          'user.firstName': 1,
          'user.lastName': 1,
          'user.profileImage': 1,
          'user.countryCode': 1,
          'user.isOnline': 1,
          'user.currentLevel': 1,
        },
      },
      { $sort: sort },
      // 5. Single round-trip for both the page and the total count.
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const result = await this.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return { total, data };
  }

  async getPaginatedListeners(matchQuery, sort, skip, limit, userMatch = {}) {
    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      { $match: { 'user.isDeleted': false, ...userMatch } },
      { $sort: sort },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];
    
    const result = await this.aggregate(pipeline);
    const total = result[0].metadata[0] ? result[0].metadata[0].total : 0;
    const data = result[0].data;

    return { total, data };
  }

  /**
   * AGENT PANEL — rich, paginated listeners owned by an agent.
   *
   * Single `$facet` round-trip. The expensive country/wallet lookups run INSIDE the
   * `data` branch, AFTER `$skip`/`$limit`, so they only touch the page-sized set.
   * The joined user replaces `userId` (populate-style) to match the frontend shape.
   *
   * @param {Object} matchQuery  Profile-side filters (createdByAgentId, kycStatus, availability, country, createdAt, totalEarnings range)
   * @param {Object} userMatch   User-side filters applied after $unwind (isDeleted, isBlocked, currentLevel, name/email search)
   * @param {Object} sort
   * @param {Number} skip
   * @param {Number} limit
   * @returns {{ total: Number, data: Array }}
   */
  async getAgentListenersPaginated(matchQuery, userMatch, sort, skip, limit) {
    const pipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userId',
        },
      },
      { $unwind: '$userId' },
      { $match: userMatch },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'countries',
                localField: 'country',
                foreignField: '_id',
                as: 'country',
              },
            },
            { $unwind: { path: '$country', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'wallets',
                localField: 'userId._id',
                foreignField: 'userId',
                as: 'wallet',
              },
            },
            { $unwind: { path: '$wallet', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1,
                createdAt: 1,
                anchorLevel: 1,
                availability: 1,
                profileStatus: 1,
                kycStatus: 1,
                magicLoginToken: 1,
                totalEarnings: 1,
                availableBalance: 1,
                totalSessions: 1,
                giftsReceivedCount: 1,
                'userId._id': 1,
                'userId.firstName': 1,
                'userId.lastName': 1,
                'userId.username': 1,
                'userId.email': 1,
                'userId.mobileNumber': 1,
                'userId.profileImage': 1,
                'userId.currentLevel': 1,
                'userId.isBlocked': 1,
                'country._id': 1,
                'country.name': 1,
                'country.code': 1,
                'country.flagUrl': 1,
                // Money columns (denormalized — see service for final mapping)
                wallet: { $ifNull: ['$wallet.coinBalance', 0] },
                recharge: { $ifNull: ['$wallet.totalRecharge', 0] },
                earnings: { $ifNull: ['$totalEarnings', 0] },
                revenue: { $ifNull: ['$totalEarnings', 0] },
                gifts: { $ifNull: ['$giftsReceivedCount', 0] },
                level: { $ifNull: ['$userId.currentLevel', 1] },
              },
            },
          ],
        },
      },
    ];

    const result = await this.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return { total, data };
  }

  /**
   * AGENT PANEL — KPI stat cards in one round-trip.
   * Counts are derived from the listener profile (availability is kept in sync by
   * the presence service, so no per-row Redis lookups are needed for the cards).
   *
   * @param {mongoose.Types.ObjectId} agentId
   * @returns {{ total: Number, active: Number, onlineNow: Number, pendingVerification: Number }}
   */
  async getAgentStats(agentId) {
    const [result] = await this.aggregate([
      { $match: { createdByAgentId: agentId } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          active: [{ $match: { kycStatus: 'APPROVED' } }, { $count: 'n' }],
          onlineNow: [{ $match: { availability: 'ONLINE' } }, { $count: 'n' }],
          pendingVerification: [{ $match: { kycStatus: 'PENDING' } }, { $count: 'n' }],
        },
      },
    ]);

    const pick = (arr) => (arr && arr[0] ? arr[0].n : 0);
    return {
      total: pick(result?.total),
      active: pick(result?.active),
      onlineNow: pick(result?.onlineNow),
      pendingVerification: pick(result?.pendingVerification),
    };
  }
}

export default new ListenerRepository();
