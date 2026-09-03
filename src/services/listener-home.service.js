import redisClient from '../config/redis.js';
import mongoose from 'mongoose';
import User from '../modules/user.model.js';
import listenerHomeRepository from '../repositories/listener-home.repository.js';
import listenerInteractionService from './listener-interaction.service.js';
import presenceService from './presence.service.js';
import ApiError from '../utils/ApiError.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { getCache, setCache, getCacheVersion } from '../utils/redis.util.js';
import {
  overlayPresenceOnCards,
  buildSectionResponse,
} from '../utils/customer-card.util.js';

const NEW_USERS_CACHE_TTL = 60;
const POPULAR_CACHE_TTL = 60;

const parseSectionPagination = (query, prefix, defaults = { page: 1, limit: 10 }) => {
  const page = parseInt(query[`${prefix}Page`], 10) || defaults.page;
  const limit = Math.min(parseInt(query[`${prefix}Limit`], 10) || defaults.limit, 50);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

class ListenerHomeService {
  /**
   * GET /home/listener-home — online, new, and popular customer sections.
   */
  async getListenerHome(listenerId, query = {}) {
    const section = query.section;

    if (section === 'online') {
      const pagination = parseSectionPagination(query, 'online');
      const onlineUsers = await this._getOnlineUsers(listenerId, pagination);
      return { onlineUsers };
    }

    if (section === 'new') {
      const pagination = parseSectionPagination(query, 'new');
      const newUsers = await this._getNewUsers(listenerId, pagination);
      return { newUsers };
    }

    if (section === 'popular') {
      const pagination = parseSectionPagination(query, 'popular');
      const popularUsers = await this._getPopularUsers(pagination);
      return { popularUsers };
    }

    const [onlinePagination, newPagination, popularPagination] = [
      parseSectionPagination(query, 'online'),
      parseSectionPagination(query, 'new'),
      parseSectionPagination(query, 'popular'),
    ];

    const [onlineUsers, newUsers, popularUsers] = await Promise.all([
      this._getOnlineUsers(listenerId, onlinePagination),
      this._getNewUsers(listenerId, newPagination),
      this._getPopularUsers(popularPagination),
    ]);

    return { onlineUsers, newUsers, popularUsers };
  }

  async _getOnlineUsers(listenerId, { page, limit, skip }) {
    // 1. Get interacted customer IDs
    const interactedIds = await listenerInteractionService.getInteractedCustomerIds(listenerId);

    // 2. Also get globally online customer IDs from Redis set
    let globalOnlineIds = [];
    if (redisClient.isRedisAvailable) {
      const redisIds = (await redisClient.smembers(KEYS.onlineCustomers())) || [];
      globalOnlineIds = redisIds.map((id) => id.toString());
    }

    // 3. Fallback: find any online customers in MongoDB if needed
    let mongoOnlineIds = [];
    if (!interactedIds.length && !globalOnlineIds.length) {
      const activeCustomers = await User.find({ type: 'CUSTOMER', isOnline: true, isDeleted: false })
        .select('_id')
        .limit(50)
        .lean();
      mongoOnlineIds = activeCustomers.map((u) => u._id.toString());
    }

    // Combine distinct IDs with interacted IDs given highest priority
    const combinedIds = Array.from(new Set([...interactedIds, ...globalOnlineIds, ...mongoOnlineIds]));

    if (!combinedIds.length) {
      return buildSectionResponse([], 0, page, limit);
    }

    const statusMap = await presenceService.getStatusBatch(combinedIds);
    const onlineIds = combinedIds.filter((id) => {
      const status = statusMap.get(id) || 'OFFLINE';
      return status !== 'OFFLINE';
    });

    if (!onlineIds.length) {
      return buildSectionResponse([], 0, page, limit);
    }

    const lastInteractionMap = await listenerHomeRepository.getLastInteractionMap(listenerId, onlineIds);

    const sortedOnlineIds = onlineIds.sort((a, b) => {
      const aTime = lastInteractionMap.get(a)?.getTime() || 0;
      const bTime = lastInteractionMap.get(b)?.getTime() || 0;
      return bTime - aTime;
    });

    const total = sortedOnlineIds.length;
    const pageIds = sortedOnlineIds.slice(skip, skip + limit);

    const users = await listenerHomeRepository.findCustomersByIdsOrdered(pageIds);
    const usersWithInteraction = users.map((user) => ({
      ...user,
      lastInteractionAt: lastInteractionMap.get(user._id.toString()) || null,
    }));

    const docs = overlayPresenceOnCards(
      usersWithInteraction,
      statusMap,
      redisClient.isRedisAvailable
    );

    return buildSectionResponse(docs, total, page, limit);
  }

  async _getNewUsers(listenerId, { page, limit, skip }) {
    const listenerIdStr = listenerId.toString();
    const version = await getCacheVersion(`listener:home:${listenerIdStr}`);
    const cacheKey = `listener:home:new:v${version}:${listenerIdStr}:${page}:${limit}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      const ids = cached.data.map((u) => u._id?.toString() || u.id);
      const statusMap = await presenceService.getStatusBatch(ids);
      const docs = overlayPresenceOnCards(cached.data, statusMap, redisClient.isRedisAvailable);
      return buildSectionResponse(docs, cached.total, page, limit);
    }

    const fetchLimit = limit * 3;
    let collected = [];
    let dbSkip = skip;
    let total = 0;
    let safety = 0;

    while (collected.length < limit && safety < 5) {
      const batch = await listenerHomeRepository.findNewCustomersForListener(
        listenerIdStr,
        dbSkip,
        fetchLimit
      );

      if (safety === 0) {
        total = batch.total;
      }

      if (!batch.data.length) break;

      const batchIds = batch.data.map((u) => u._id.toString());
      const interactedSet = await listenerInteractionService.filterInteractedIds(
        listenerIdStr,
        batchIds
      );

      const filtered = batch.data.filter((u) => !interactedSet.has(u._id.toString()));
      collected = collected.concat(filtered);

      dbSkip += fetchLimit;
      safety += 1;

      if (dbSkip >= batch.total) break;
    }

    const pageData = collected.slice(0, limit);

    await setCache(cacheKey, { data: pageData, total }, NEW_USERS_CACHE_TTL);

    const ids = pageData.map((u) => u._id.toString());
    const statusMap = await presenceService.getStatusBatch(ids);
    const docs = overlayPresenceOnCards(pageData, statusMap, redisClient.isRedisAvailable);

    return buildSectionResponse(docs, total, page, limit);
  }

  async _getPopularUsers({ page, limit, skip }) {
    const version = await getCacheVersion('customers:popular');
    const cacheKey = `listener:home:popular:v${version}:${page}:${limit}`;

    const cached = await getCache(cacheKey);
    let total;
    let pageData;

    if (cached) {
      total = cached.total;
      pageData = cached.data;
    } else {
      const result = await listenerHomeRepository.findPopularCustomers(skip, limit);
      total = result.total;
      pageData = result.data;
      await setCache(cacheKey, { data: pageData, total }, POPULAR_CACHE_TTL);
    }

    const ids = pageData.map((u) => u._id.toString());
    const statusMap = await presenceService.getStatusBatch(ids);
    const docs = overlayPresenceOnCards(pageData, statusMap, redisClient.isRedisAvailable);

    return buildSectionResponse(docs, total, page, limit);
  }

  /**
   * GET /home/customer/:userId — listener-safe public customer profile.
   * Omits email/mobile/wallet; includes presence + country/languages.
   */
  async getCustomerPublicProfile(customerId) {
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      throw new ApiError(400, 'Invalid customer id');
    }

    const user = await User.findOne({
      _id: customerId,
      type: 'CUSTOMER',
      isDeleted: false,
      isBlocked: false,
    })
      .select(
        'firstName lastName profileImage gender countryCode country age languages currentLevel totalXp badges isOnline createdAt profileCompleted username isGuest'
      )
      .populate('country', 'name emoji flag code')
      .populate('languages', 'name code')
      .lean();

    if (!user) {
      throw new ApiError(404, 'Customer not found');
    }

    const liveStatus = await presenceService.getStatus(customerId);
    const isOnline = liveStatus !== 'OFFLINE' || !!user.isOnline;
    const languageDetails = (user.languages || [])
      .filter(Boolean)
      .map((l) =>
        typeof l === 'object'
          ? { _id: l._id?.toString(), name: l.name, code: l.code }
          : { _id: String(l), name: String(l) }
      );
    const countryDetails =
      user.country && typeof user.country === 'object'
        ? {
            _id: user.country._id?.toString(),
            name: user.country.name,
            emoji: user.country.emoji || user.country.flag,
            flag: user.country.flag || user.country.emoji,
            code: user.country.code || user.countryCode,
          }
        : user.countryCode
          ? { code: user.countryCode, name: user.countryCode }
          : null;

    return {
      id: user._id.toString(),
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      username: user.username || null,
      profileImage: user.profileImage || null,
      gender: user.gender || null,
      age: user.age || null,
      countryCode: user.countryCode || countryDetails?.code || null,
      countryDetails,
      languageDetails,
      languages: languageDetails.map((l) => l.name).filter(Boolean),
      currentLevel: user.currentLevel || 1,
      totalXp: user.totalXp || 0,
      badges: user.badges || [],
      isOnline,
      liveStatus: isOnline ? liveStatus || 'ONLINE' : 'OFFLINE',
      profileCompleted: !!user.profileCompleted,
      isGuest: !!user.isGuest,
      memberSince: user.createdAt || null,
      // Customers have no bio/interests on User — UI shows placeholders when empty
      about: null,
      interests: [],
    };
  }
}

export default new ListenerHomeService();
