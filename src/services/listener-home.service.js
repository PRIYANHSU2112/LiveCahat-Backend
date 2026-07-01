import redisClient from '../config/redis.js';
import listenerHomeRepository from '../repositories/listener-home.repository.js';
import listenerInteractionService from './listener-interaction.service.js';
import presenceService from './presence.service.js';
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
    const interactedIds = await listenerInteractionService.getInteractedCustomerIds(listenerId);

    if (!interactedIds.length) {
      return buildSectionResponse([], 0, page, limit);
    }

    const statusMap = await presenceService.getStatusBatch(interactedIds);
    const onlineIds = interactedIds.filter((id) => {
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
      lastInteractionAt: lastInteractionMap.get(user._id.toString()),
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
}

export default new ListenerHomeService();
