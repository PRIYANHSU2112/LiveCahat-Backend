import BaseService from './base.service.js';
import userRepository from '../repositories/user.repository.js';
import listenerRepository from '../repositories/listener.repository.js';
import userActivityService from './user-activity.service.js';
import agentAnalyticsRepository from '../repositories/agent-analytics.repository.js';
import withdrawalService from './withdrawal.service.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import ApiError from '../utils/ApiError.js';
import { deleteFromS3 } from '../utils/aws.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import { getDateBoundaries, buildComparison } from '../utils/stats.util.js';
import { resolveAdminAnalyticsRange } from '../utils/date-filter.util.js';

const MS_DAY = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const commissionFrom = (revenue, rate) => round2((revenue * rate) / 100);
const formatInr = (amount) =>
  `₹${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

class UserService extends BaseService {
  constructor() {
    super(userRepository);
  }

  /**
   * Resolve analytics window for agent roster period earnings.
   * Defaults to last 7 days; keeps exact dateTo for rolling presets.
   */
  _resolveAgentRosterRange(queryParams) {
    const rangeQuery = { ...queryParams };
    if (!rangeQuery.dateFrom && !rangeQuery.dateTo && !rangeQuery.year) {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * MS_DAY);
      rangeQuery.dateFrom = start.toISOString();
      rangeQuery.dateTo = end.toISOString();
    }

    const { start, end: resolvedEnd } = resolveAdminAnalyticsRange(rangeQuery);
    const end =
      rangeQuery.dateFrom && rangeQuery.dateTo
        ? new Date(rangeQuery.dateTo)
        : resolvedEnd;
    return { start, end };
  }

  /**
   * Attach period commission coins + INR for the current page of agents.
   */
  async _attachAgentPeriodEarnings(agents, start, end) {
    if (!agents.length) return agents;

    const [listenerCoinsByAgent, withdrawalConfig] = await Promise.all([
      agentAnalyticsRepository.sumPeriodListenerCoinsByAgentIds(
        agents.map((a) => a._id),
        start,
        end,
      ),
      withdrawalService.getConfig(),
    ]);

    const conversionCoins = withdrawalConfig.conversionCoins || 1000;
    const conversionInr = withdrawalConfig.conversionInr || 100;
    const rate = conversionCoins > 0 ? conversionInr / conversionCoins : 0;

    return agents.map((agent) => {
      const agentId = String(agent._id);
      const listenerCoins = listenerCoinsByAgent.get(agentId) || 0;
      const periodCommissionCoins = commissionFrom(
        listenerCoins,
        Number(agent.commissionPercentage) || 0,
      );
      return {
        ...agent,
        periodCommissionCoins,
        inrEarnings: formatInr(round2(periodCommissionCoins * rate)),
      };
    });
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

    let docs = data;
    if (queryParams.type === 'AGENT' && docs.length) {
      const { start, end } = this._resolveAgentRosterRange(queryParams);
      docs = await this._attachAgentPeriodEarnings(docs, start, end);
    }

    const response = formatPaginatedResponse(docs, total, page, limit);

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
      type: 'AGENT',
    });

    await bumpCacheVersion('users');

    agent.password = undefined;
    return agent;
  }

  async updateAgentUser(agentId, data) {
    const agent = await this.repository.findById(agentId, '', '', false);
    if (!agent || agent.type !== 'AGENT') {
      throw new ApiError(404, 'Agent not found');
    }

    if (data.email && data.email !== agent.email) {
      const existing = await this.repository.findOne({ email: data.email });
      if (existing && String(existing._id) !== String(agentId)) {
        throw new ApiError(400, 'Email already in use');
      }
    }

    const allowed = [
      'firstName',
      'lastName',
      'email',
      'mobileNumber',
      'commissionPercentage',
      'password',
      'aadhaarFront',
      'aadhaarBack',
    ];

    for (const key of allowed) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') {
        agent[key] = data[key];
      }
    }

    await agent.save();
    await Promise.all([
      deleteCache(`user:${agentId}`),
      deleteCache(`auth:user:${agentId}`),
      bumpCacheVersion('users'),
    ]);

    const updated = agent.toObject();
    delete updated.password;
    return updated;
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

  async getAgentAdminStats(queryParams = {}) {
    const { start, end } = this._resolveAgentRosterRange(queryParams);
    const rangeKey = `${start.toISOString()}_${end.toISOString()}`;

    const version = await getCacheVersion('users');
    const cacheKey = `users:stats:agent:v${version}:${rangeKey}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const raw = await this.repository.getAgentAdminStats({ start, end });

    const listenerCoinsByAgent =
      await agentAnalyticsRepository.sumPeriodListenerCoinsByAgentIds(
        (raw.agents || []).map((a) => a._id),
        start,
        end,
      );

    let periodCommissionTotal = 0;
    for (const agent of raw.agents || []) {
      const listenerCoins = listenerCoinsByAgent.get(String(agent._id)) || 0;
      periodCommissionTotal += commissionFrom(
        listenerCoins,
        Number(agent.commissionPercentage) || 0,
      );
    }
    periodCommissionTotal = round2(periodCommissionTotal);

    const stats = {
      totalAgents: { count: raw.totalAgents },
      totalListenersByAgents: { count: raw.totalListeners },
      averageCommission: { count: Math.round(raw.averageCommission * 100) / 100 },
      totalAgentEarnings: { count: periodCommissionTotal },
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
