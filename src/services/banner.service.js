import BaseService from './base.service.js';
import bannerRepository from '../repositories/banner.repository.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';

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
      await setCache(cacheKey, banners, 3600); // cache for 1 hour
    }

    return banners;
  }

  /**
   * Invalidate active banners cache on any write/CRUD operation.
   */
  async clearBannersCache() {
    await deleteCache('banners:active');
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
