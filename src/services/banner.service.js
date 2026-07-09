import BaseService from './base.service.js';
import bannerRepository from '../repositories/banner.repository.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import { getPaginationOptions } from '../utils/pagination.util.js';

class BannerService extends BaseService {
  constructor() {
    super(bannerRepository);
  }

  /**
   * Get all active banners (User side) - fast and cached in Redis.
   */
  async getActiveBanners() {
    const cacheKey = 'banners:active';
    let banners = await getCache(cacheKey);

    if (!banners) {
      banners = await this.repository.findActiveSorted();
      await setCache(cacheKey, banners, 3600);
    }

    return banners;
  }

  async clearBannersCache() {
    await deleteCache('banners:active');
  }

  async getAdminStats() {
    const [total, active, inactive] = await Promise.all([
      this.repository.countDocuments({}),
      this.repository.countDocuments({ isActive: true }),
      this.repository.countDocuments({ isActive: false }),
    ]);
    return { total, active, inactive };
  }

  async getAllBanners(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: query.sortBy || (query.sort === 'createdAt' ? 'createdAt' : 'position'),
      sortOrder: query.sortOrder || (query.sort === 'createdAt' ? 'desc' : 'asc'),
      page: query.page,
      limit: query.limit,
    });

    const filter = {};
    if (query.search) {
      filter.title = { $regex: query.search.trim(), $options: 'i' };
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const [banners, total] = await Promise.all([
      this.repository.findMany(filter, '', '', sort, limit, skip),
      this.repository.countDocuments(filter),
    ]);

    return {
      banners,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  async createBanner(data) {
    const banner = await this.repository.create(data);
    await this.clearBannersCache();
    return banner;
  }

  async updateBanner(id, data) {
    const banner = await this.repository.updateById(id, data);
    await this.clearBannersCache();
    return banner;
  }

  async deleteBanner(id) {
    const result = await this.repository.deleteById(id);
    await this.clearBannersCache();
    return result;
  }
}

export default new BannerService();
