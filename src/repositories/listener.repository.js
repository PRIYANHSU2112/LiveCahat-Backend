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

  async getPaginatedListeners(matchQuery, sort, skip, limit) {
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
      { $match: { 'user.isDeleted': false, 'user.isBlocked': false } },
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
}

export default new ListenerRepository();
