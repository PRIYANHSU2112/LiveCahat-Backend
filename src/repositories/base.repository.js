/**
 * Base Repository pattern implementing common Mongoose queries.
 * Decouples database operations from business logic.
 */
export default class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async   create(data) {
    return await this.model.create(data);
  }

  async findById(id, select = '', populate = '', lean = true) {
    let query = this.model.findById(id).select(select).populate(populate);
    if (lean) query = query.lean();
    return await query;
  }

  async findOne(filter, select = '', populate = '', lean = true) {
    let query = this.model.findOne(filter).select(select).populate(populate);
    if (lean) query = query.lean();
    return await query;
  }

  async findMany(filter, select = '', populate = '', sort = {}, limit = 10, skip = 0, lean = true) {
    let query = this.model.find(filter).select(select).populate(populate).sort(sort).limit(limit).skip(skip);
    if (lean) query = query.lean();
    return await query;
  }

  async updateById(id, data, options = { new: true, runValidators: true }) {
    return await this.model.findByIdAndUpdate(id, data, options);
  }

  async updateOne(filter, data, options = { new: true, runValidators: true }) {
    return await this.model.findOneAndUpdate(filter, data, options);
  }

  async deleteById(id) {
    return await this.model.findByIdAndDelete(id);
  }

  async softDeleteById(id) {
    return await this.model.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() }, { new: true });
  }

  async countDocuments(filter = {}) {
    return await this.model.countDocuments(filter);
  }

  async aggregate(pipeline) {
    return await this.model.aggregate(pipeline);
  }
}
