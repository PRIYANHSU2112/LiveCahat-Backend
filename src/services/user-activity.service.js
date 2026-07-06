import userActivityRepository from '../repositories/user-activity.repository.js';
import { getDateBoundaries, buildComparison } from '../utils/stats.util.js';
import { getCache, setCache, getCacheVersion } from '../utils/redis.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

class UserActivityService {
  async getCustomerActivityStats() {
    const version = await getCacheVersion('users');
    const cacheKey = `users:activity:stats:v${version}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const boundaries = getDateBoundaries();
    const raw = await userActivityRepository.getCustomerActivityStats(boundaries);

    const stats = {
      activeNow: { count: raw.activeNow },
      active24h: buildComparison(raw.active24h, raw.active24h),
      suspicious: { count: raw.suspicious },
      newDevices24h: { count: raw.newDevices24h },
    };

    await setCache(cacheKey, stats, 30);
    return stats;
  }

  async getCustomerActivityFeed(queryParams) {
    const version = await getCacheVersion('users');
    const cacheKey = `users:activity:feed:v${version}:${JSON.stringify(queryParams)}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { page, limit, skip } = getPaginationOptions(queryParams);
    const { total, docs } = await userActivityRepository.getCustomerActivityFeed(skip, limit);
    const response = formatPaginatedResponse(docs, total, page, limit);

    await setCache(cacheKey, response, 30);
    return response;
  }
}

export default new UserActivityService();
