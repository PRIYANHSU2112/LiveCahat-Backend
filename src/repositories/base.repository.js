/**
 * Base Repository pattern implementing common Mongoose queries.
 * Decouples database operations from business logic.
 */
export default class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    return await this.model.create(data);
  }

  async findById(id, select = '', populate = '') {
    return await this.model.findById(id).select(select).populate(populate);
  }

  async findOne(query, select = '', populate = '') {
    return await this.model.findOne(query).select(select).populate(populate);
  }

  async findMany(query, select = '', populate = '', sort = {}, limit = 10, skip = 0) {
    return await this.model.find(query).select(select).populate(populate).sort(sort).limit(limit).skip(skip);
  }

  async updateById(id, data, options = { new: true, runValidators: true }) {
    return await this.model.findByIdAndUpdate(id, data, options);
  }

  async deleteById(id) {
    return await this.model.findByIdAndDelete(id);
  }

  async countDocuments(query = {}) {
    return await this.model.countDocuments(query);
  }
}
