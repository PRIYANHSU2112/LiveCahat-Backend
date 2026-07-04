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
   * @param {{ compact?: boolean }} [options]  compact=true skips wallet join and returns a smaller projection
   * @returns {{ total: Number, data: Array }}
   */
  async getAgentListenersPaginated(matchQuery, userMatch, sort, skip, limit, options = {}) {
    const { compact = false } = options;

    const dataStages = [
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
    ];

    if (!compact) {
      dataStages.push(
        {
          $lookup: {
            from: 'wallets',
            localField: 'userId._id',
            foreignField: 'userId',
            as: 'wallet',
          },
        },
        { $unwind: { path: '$wallet', preserveNullAndEmptyArrays: true } },
      );
    }

    dataStages.push({
      $project: compact
        ? {
            _id: 1,
            anchorLevel: 1,
            availability: 1,
            kycStatus: 1,
            'userId._id': 1,
            'userId.firstName': 1,
            'userId.lastName': 1,
            'userId.username': 1,
            'userId.email': 1,
            'userId.mobileNumber': 1,
            'userId.profileImage': 1,
            'userId.isBlocked': 1,
            'country._id': 1,
            'country.name': 1,
            'country.code': 1,
            'country.flagUrl': 1,
          }
        : {
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
            wallet: { $ifNull: ['$wallet.coinBalance', 0] },
            recharge: { $ifNull: ['$wallet.totalRecharge', 0] },
            earnings: { $ifNull: ['$totalEarnings', 0] },
            revenue: { $ifNull: ['$totalEarnings', 0] },
            gifts: { $ifNull: ['$giftsReceivedCount', 0] },
            level: { $ifNull: ['$userId.currentLevel', 1] },
          },
    });

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
          data: dataStages,
        },
      },
    ];

    const result = await this.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return { total, data };
  }

  /**
   * AGENT PANEL — raw counts for the KPI stat cards in one round-trip.
   *
   * Availability counts come straight from the listener profile (kept in sync by
   * the presence service). Blocked counts require the owning user (`isBlocked` /
   * `blockedAt`), so the profile is joined to its user. Time-bounded buckets use
   * the boundaries computed by the caller; the service layer turns these raw
   * numbers into count/percentage/trend cards.
   *
   * @param {mongoose.Types.ObjectId} agentId
   * @param {{ startOfToday: Date, startOfYesterday: Date, startOfThisMonth: Date, startOfLastMonth: Date }} boundaries
   * @returns {Object} raw counts keyed by bucket name
   */
  async getAgentStats(agentId, boundaries) {
    const { startOfToday, startOfYesterday, startOfThisMonth, startOfLastMonth } = boundaries;

    const [result] = await this.aggregate([
      { $match: { createdByAgentId: agentId } },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
            { $project: { isBlocked: 1, blockedAt: 1 } },
          ],
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $facet: {
          // Roster totals (no comparison)
          total: [{ $count: 'n' }],
          onlineNow: [
            { $match: { availability: { $in: ['ONLINE', 'BUSY'] } } },
            { $count: 'n' },
          ],

          // Availability (no comparison)
          inSession: [{ $match: { availability: 'BUSY' } }, { $count: 'n' }],
          idle: [{ $match: { availability: 'ONLINE' } }, { $count: 'n' }],

          // KYC review (no comparison)
          inReview: [{ $match: { kycStatus: 'UNDER_REVIEW' } }, { $count: 'n' }],

          // Pending — total now vs end of last month (createdAt snapshot)
          pendingTotal: [{ $match: { kycStatus: 'PENDING' } }, { $count: 'n' }],
          pendingPrevMonth: [
            { $match: { kycStatus: 'PENDING', createdAt: { $lt: startOfThisMonth } } },
            { $count: 'n' },
          ],

          // Approved — total now vs end of last month + today vs yesterday
          approvedTotal: [{ $match: { kycStatus: 'APPROVED' } }, { $count: 'n' }],
          approvedPrevMonth: [
            { $match: { kycStatus: 'APPROVED', kycApprovedAt: { $lt: startOfThisMonth } } },
            { $count: 'n' },
          ],
          approvedToday: [
            { $match: { kycStatus: 'APPROVED', kycApprovedAt: { $gte: startOfToday } } },
            { $count: 'n' },
          ],
          approvedYesterday: [
            { $match: { kycStatus: 'APPROVED', kycApprovedAt: { $gte: startOfYesterday, $lt: startOfToday } } },
            { $count: 'n' },
          ],

          // Blocked — total now vs end of last month + this month vs last month
          blockedTotal: [{ $match: { 'user.isBlocked': true } }, { $count: 'n' }],
          blockedPrevMonth: [
            { $match: { 'user.isBlocked': true, 'user.blockedAt': { $lt: startOfThisMonth } } },
            { $count: 'n' },
          ],
          blockedThisMonth: [
            { $match: { 'user.isBlocked': true, 'user.blockedAt': { $gte: startOfThisMonth } } },
            { $count: 'n' },
          ],
          blockedLastMonth: [
            { $match: { 'user.isBlocked': true, 'user.blockedAt': { $gte: startOfLastMonth, $lt: startOfThisMonth } } },
            { $count: 'n' },
          ],
        },
      },
    ]);

    const pick = (arr) => (arr && arr[0] ? arr[0].n : 0);
    return {
      total: pick(result?.total),
      onlineNow: pick(result?.onlineNow),
      inSession: pick(result?.inSession),
      idle: pick(result?.idle),
      inReview: pick(result?.inReview),
      pendingTotal: pick(result?.pendingTotal),
      pendingPrevMonth: pick(result?.pendingPrevMonth),
      approvedTotal: pick(result?.approvedTotal),
      approvedPrevMonth: pick(result?.approvedPrevMonth),
      approvedToday: pick(result?.approvedToday),
      approvedYesterday: pick(result?.approvedYesterday),
      blockedTotal: pick(result?.blockedTotal),
      blockedPrevMonth: pick(result?.blockedPrevMonth),
      blockedThisMonth: pick(result?.blockedThisMonth),
      blockedLastMonth: pick(result?.blockedLastMonth),
    };
  }
}

export default new ListenerRepository();
