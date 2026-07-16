import BaseService from './base.service.js';
import userRepository from '../repositories/user.repository.js';
import listenerRepository from '../repositories/listener.repository.js';
import userActivityService from './user-activity.service.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import ApiError from '../utils/ApiError.js';
import { deleteFromS3 } from '../utils/aws.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { getDateBoundaries, buildComparison } from '../utils/stats.util.js';

class UserService extends BaseService {
  constructor() {
    super(userRepository);
  }

  async getItemById(userId) {
    const cacheKey = `user:${userId}`;
    const cachedUser = await getCache(cacheKey);
    if (cachedUser) return cachedUser;

    const user = await this.repository.findById(userId, '', 'country');
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
    if (queryParams.isBlocked !== undefined) {
      matchQuery.isBlocked = queryParams.isBlocked === true || queryParams.isBlocked === 'true';
    }
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
    // Track when the user entered the blocked state so agent stat cards can
    // compute "blocked this month" and month-over-month trends.
    user.blockedAt = isBlocked ? new Date() : null;
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

    if (data.roleId) {
      const roleRepository = (await import('../repositories/role.repository.js')).default;
      const role = await roleRepository.findById(data.roleId);
      if (!role || !role.isActive) {
        throw new ApiError(400, 'Invalid or inactive role');
      }
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

    if (data.age !== undefined && Number(data.age) < 18) {
      throw new ApiError(400, 'Listener must be at least 18 years old');
    }

    const listenerUser = await this.repository.create({
      ...data,
      type: 'LISTENER',
      ageVerified: true,
    });

    await listenerRepository.create({ userId: listenerUser._id });

    await Promise.all([
      bumpCacheVersion('users'),
      bumpCacheVersion('listeners')
    ]);
    
    return listenerUser;
  }

  async createAgentUser(data) {
    const existingUser = await this.repository.findOne({ email: data.email });
    if (existingUser) {
      throw new ApiError(400, 'Email already in use');
    }

    const agent = await this.repository.create({
      ...data,
      type: 'AGENT'
    });

    await bumpCacheVersion('users');
    
    agent.password = undefined;
    return agent;
  }

  async updateAgentCommission(agentId, commissionPercentage) {
    const agent = await this.repository.updateById(agentId, { commissionPercentage });
    if (!agent || agent.type !== 'AGENT') {
      throw new ApiError(404, 'Agent not found');
    }
    await bumpCacheVersion('users');
    return agent;
  }

  async getCustomerStats() {
    const version = await getCacheVersion('users');
    const cacheKey = `users:stats:customer:v${version}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const boundaries = getDateBoundaries();
    const raw = await this.repository.getCustomerAdminStats(boundaries);

    const stats = {
      totalUsers: { count: raw.totalUsers },
      activeToday: buildComparison(raw.activeToday, raw.activeTodayPrevious),
      new7d: buildComparison(raw.new7d, raw.new7dPrevious),
      blocked: buildComparison(raw.blocked, raw.blockedPrevious),
    };

    await setCache(cacheKey, stats, 30);
    return stats;
  }


  async getCustomerActivityStats() {
    return userActivityService.getCustomerActivityStats();
  }

  async getCustomerActivityFeed(queryParams) {
    return userActivityService.getCustomerActivityFeed(queryParams);
  }

  async getAgentAdminStats() {
    const version = await getCacheVersion('users');
    const cacheKey = `users:stats:agent:v${version}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const raw = await this.repository.getAgentAdminStats();

    const stats = {
      totalAgents: { count: raw.totalAgents },
      totalListenersByAgents: { count: raw.totalListeners },
      averageCommission: { count: Math.round(raw.averageCommission * 100) / 100 },
      totalAgentEarnings: { count: raw.totalAgentEarnings }
    };

    await setCache(cacheKey, stats, 30);
    return stats;
  }

  async getBlockedAccountStats() {
    const version = await getCacheVersion('users');
    const cacheKey = `users:blocked-stats:v${version}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const stats = await this.repository.getBlockedAccountStats();
    await setCache(cacheKey, stats, 30);
    return stats;
  }
}

export default new UserService();
