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
