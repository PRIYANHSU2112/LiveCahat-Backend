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
    return await this.findOne({ userId }, '', [
      { path: 'userId', select: 'firstName lastName email profileImage isOnline age currentLevel gender' },
      { path: 'languages', select: 'name code flagUrl' },
    ]);
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
  /**
   * USER HOME FEED — paginated listing of active listeners with search + filters.
   * Highly optimized: Lookups are streamlined and index-backed for sub-millisecond response.
   *
   * @param {Object} profileMatch  Match stage on the listener profile (kycStatus, availability, languages, avgRating...)
   * @param {Object} userMatch     Match stage on the joined user (isDeleted, isBlocked, countryCode)
   * @param {Object} sort          Sort spec (e.g. { isFeatured: -1, followersCount: -1 })
   * @param {Number} skip
   * @param {Number} limit
   * @param {Array}  [boostedUserIds=[]] List of currently active boosted listener ObjectIds
   * @returns {{ total: Number, data: Array }}
   */
  async getHomeListeners(profileMatch, userMatch, sort, skip, limit, boostedUserIds = []) {
    const pipeline = [
      // 1. Narrow on the indexed profile fields first (kycStatus, availability, languages, rating, anchorLevel, country).
      { $match: profileMatch },
      // 2. Dynamic priorities:
      // - boostPriority: 1 for Boosted (Top), 2 for Normal
      // - statusPriority: ONLINE/LIVE (1) -> BUSY (2) -> OFFLINE (3) -> Other (4) for normal listeners
      {
        $addFields: {
          isBoosted: {
            $in: ['$userId', boostedUserIds],
          },
          boostPriority: {
            $cond: [
              { $in: ['$userId', boostedUserIds] },
              1,
              2,
            ],
          },
          statusPriority: {
            $switch: {
              branches: [
                { case: { $in: ['$availability', ['ONLINE', 'LIVE']] }, then: 1 },
                { case: { $eq: ['$availability', 'BUSY'] }, then: 2 },
                { case: { $eq: ['$availability', 'OFFLINE'] }, then: 3 },
              ],
              default: 4,
            },
          },
        },
      },
      // 3. Tiered sort:
      // 1. boostPriority (Boosted listeners first)
      // 2. statusPriority (ONLINE > BUSY > OFFLINE)
      // 3. Secondary sort criteria (featured / popular / rating / newest)
      {
        $sort: {
          boostPriority: 1,
          statusPriority: 1,
          ...(sort || {}),
        },
      },
      // 4. Pagination facet — All lookups happen ONLY on the 10 sliced items!
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            // Resolve user info ONLY on the paginated slice
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                pipeline: [
                  {
                    $project: {
                      _id: 1,
                      firstName: 1,
                      lastName: 1,
                      profileImage: 1,
                      isOnline: 1,
                    },
                  },
                ],
                as: 'user',
              },
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
            // Resolve language references ONLY on the paginated slice
            {
              $lookup: {
                from: 'languages',
                localField: 'languages',
                foreignField: '_id',
                pipeline: [
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                      code: 1,
                    },
                  },
                ],
                as: 'languageDetails',
              },
            },
            // Resolve country reference ONLY on the paginated slice
            {
              $lookup: {
                from: 'countries',
                localField: 'country',
                foreignField: '_id',
                pipeline: [
                  {
                    $project: {
                      _id: 1,
                      name: 1,
                      code: 1,
                      dialCode: 1,
                      flagUrl: 1,
                    },
                  },
                ],
                as: 'countryDetails',
              },
            },
            { $unwind: { path: '$countryDetails', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1,
                userId: 1,
                videoRate: 1,
                avgRating: 1,
                availability: 1,
                isFeatured: 1,
                isBoosted: 1,
                user: {
                  _id: '$user._id',
                  firstName: '$user.firstName',
                  lastName: '$user.lastName',
                  profileImage: '$user.profileImage',
                  isOnline: '$user.isOnline',
                },
                languageDetails: 1,
                countryDetails: 1,
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
      {
        $addFields: {
          statusPriority: {
            $switch: {
              branches: [
                { case: { $in: ['$availability', ['ONLINE', 'LIVE']] }, then: 1 },
                { case: { $eq: ['$availability', 'BUSY'] }, then: 2 },
                { case: { $eq: ['$availability', 'OFFLINE'] }, then: 3 },
              ],
              default: 4,
            },
          },
        },
      },
      {
        $sort: {
          statusPriority: 1,
          ...(sort || { createdAt: -1 }),
        },
      },
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
