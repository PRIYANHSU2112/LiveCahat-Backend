import BaseService from './base.service.js';
import userRepository from '../repositories/user.repository.js';
import listenerRepository from '../repositories/listener.repository.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import ApiError from '../utils/ApiError.js';
import { deleteFromS3 } from '../utils/aws.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

class UserService extends BaseService {
  constructor() {
    super(userRepository);
  }

  async getItemById(userId) {
    const cacheKey = `user:${userId}`;
    const cachedUser = await getCache(cacheKey);
    if (cachedUser) return cachedUser;

    const user = await this.repository.findById(userId);
    if (user) await setCache(cacheKey, user, 300); // 5 minutes cache
    return user;
  }

  async updateProfile(userId, updateData) {
    const user = await this.repository.findById(userId, '', '', false);
    if (!user) throw new ApiError(404, 'User not found');

    // If a new profile image is uploaded and an old one exists, delete the old one from S3
    if (updateData.profileImage && user.profileImage) {
      await deleteFromS3(user.profileImage);
    }

    const updated = await this.repository.updateById(userId, updateData);
    
    await Promise.all([
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
      bumpCacheVersion('users')
    ]);

    return updated;
  }

  async deleteUser(userId) {
    const deleted = await this.repository.softDeleteById(userId);
    
    await Promise.all([
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
      bumpCacheVersion('users')
    ]);

    return deleted;
  }

  async getSettings(userId) {
    const user = await this.getItemById(userId); // cached
    if (!user) throw new ApiError(404, 'User not found');
    return user.settings || {};
  }

  async updateSettings(userId, data) {
    // Dotted $set so only the provided toggles change, leaving the rest intact
    const update = {};
    for (const [key, value] of Object.entries(data)) {
      update[`settings.${key}`] = value;
    }

    const user = await this.repository.updateById(userId, { $set: update });
    if (!user) throw new ApiError(404, 'User not found');

    await Promise.all([
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
    ]);

    return user.settings;
  }

  async getAllUsers(queryParams) {
    const version = await getCacheVersion('users');
    const cacheKey = `users:list:v${version}:${JSON.stringify(queryParams)}`;
    
    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    
    const matchQuery = { isDeleted: false };
    
    if (queryParams.type) matchQuery.type = queryParams.type;
    if (queryParams.isBlocked !== undefined) matchQuery.isBlocked = queryParams.isBlocked === 'true';
    if (queryParams.search) {
      matchQuery.$or = [
        { firstName: { $regex: queryParams.search, $options: 'i' } },
        { lastName: { $regex: queryParams.search, $options: 'i' } },
        { mobileNumber: { $regex: queryParams.search, $options: 'i' } },
        { email: { $regex: queryParams.search, $options: 'i' } },
      ];
    }

    const { total, data } = await this.repository.getPaginatedUsers(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300); // 5 mins cache
    return response;
  }

  async blockUser(userId, data) {
    const { isBlocked } = data;
    const user = await this.repository.findById(userId, '', '', false);
    if (!user) throw new ApiError(404, 'User not found');

    user.isBlocked = isBlocked;
    await user.save();

    await Promise.all([
      deleteCache(`user:${userId}`),
      deleteCache(`auth:user:${userId}`),
      bumpCacheVersion('users')
    ]);

    return user;
  }

  async createAdminUser(data) {
    const existingUser = await this.repository.findOne({ email: data.email });
    if (existingUser) {
      throw new ApiError(400, 'Email already in use');
    }

    const admin = await this.repository.create({
      ...data,
      type: 'ADMIN'
    });

    await bumpCacheVersion('users');
    
    // Remove password from response
    admin.password = undefined;
    return admin;
  }

  async createListenerUser(data) {
    const existingUser = await this.repository.findOne({ mobileNumber: data.mobileNumber });
    if (existingUser) {
      throw new ApiError(400, 'Mobile number already in use');
    }

    if (data.dateOfBirth) {
      const diff = Date.now() - new Date(data.dateOfBirth).getTime();
      const ageDate = new Date(diff);
      const exactAge = Math.abs(ageDate.getUTCFullYear() - 1970);
      if (exactAge < 18) throw new ApiError(400, 'Listener must be at least 18 years old');
    }

    const listenerUser = await this.repository.create({
      ...data,
      type: 'LISTENER'
    });

    await listenerRepository.create({ userId: listenerUser._id });

    await Promise.all([
      bumpCacheVersion('users'),
      bumpCacheVersion('listeners')
    ]);
    
    return listenerUser;
  }
}

export default new UserService();
