import User from '../modules/user.model.js';

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

  async getPaginatedUsers(matchQuery, sort, skip, limit) {
    const pipeline = [
      { $match: matchQuery },
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

export default new UserRepository();
