import BaseService from './base.service.js';
import userRepository from '../repositories/user.repository.js';
import ApiError from '../utils/ApiError.js';

class UserService extends BaseService {
  constructor() {
    super(userRepository);
  }

  async createUser(userData) {
    const existingUser = await this.repository.findByEmail(userData.email);
    if (existingUser) {
      throw new ApiError(400, 'User already exists with this email');
    }
    
    // Hash password logic would go here
    const newUser = await this.repository.create(userData);
    
    // Example: Trigger background event (Welcome email)
    // userEvents.emit('userCreated', newUser);

    return newUser;
  }
}

export default new UserService();
