/**
 * Base Service class.
 * Business logic should be implemented in classes extending this.
 */
export default class BaseService {
  constructor(repository) {
    this.repository = repository;
  }

  async createItem(data) {
    return await this.repository.create(data);
  }

  async getItemById(id) {
    return await this.repository.findById(id);
  }

  async getItems(query = {}, select = '', populate = '', sort = {}, limit = 10, skip = 0) {
    return await this.repository.findMany(query, select, populate, sort, limit, skip);
  }

  async updateItem(id, data) {
    return await this.repository.updateById(id, data);
  }

  async deleteItem(id) {
    return await this.repository.deleteById(id);
  }
}
