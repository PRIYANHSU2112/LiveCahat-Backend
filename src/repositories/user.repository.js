import BaseRepository from './base.repository.js';

// Dummy mongoose model for example purposes
// In reality, this would be imported from '../modules/user/user.model.js'
const UserModel = {
  create: async (data) => ({ _id: '1', ...data }),
  findById: async (id) => ({ _id: id, name: 'John Doe', email: 'john@example.com' }),
  findOne: async (query) => ({ _id: '1', ...query }),
};

class UserRepository extends BaseRepository {
  constructor() {
    super(UserModel);
  }

  // Example of a custom repository method
  async findByEmail(email) {
    return await this.model.findOne({ email });
  }
}

export default new UserRepository();
