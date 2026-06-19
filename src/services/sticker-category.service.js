import BaseService from './base.service.js';
import stickerCategoryRepository from '../repositories/sticker-category.repository.js';
import stickerRepository from '../repositories/sticker.repository.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

const CACHE_NS = 'sticker_categories';

class StickerCategoryService extends BaseService {
  constructor() {
    super(stickerCategoryRepository);
  }

  async createCategory(data) {
    const category = await this.repository.create(data);
    await bumpCacheVersion(CACHE_NS);
    return category;
  }

  /**
   * Paginated + filterable category listing.
   * User side forces isActive=true and is cached (version-keyed).
   * Admin side gets real-time data with full isActive control.
   */
  async getCategories(query = {}, forAdmin = false) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'sortOrder',
      sortOrder: 'asc',
      ...query,
    });

    const filter = {};
    if (query.search) filter.name = { $regex: query.search.trim(), $options: 'i' };

    // ── Admin: live data, full filter control, no cache ──
    if (forAdmin) {
      if (query.isActive !== undefined) filter.isActive = query.isActive;

      const [docs, total] = await Promise.all([
        this.repository.findMany(filter, '', '', sort, limit, skip),
        this.repository.countDocuments(filter),
      ]);
      return formatPaginatedResponse(docs, total, page, limit);
    }

    // ── User: active only, version-keyed cache ──
    filter.isActive = true;

    const version = await getCacheVersion(CACHE_NS);
    const cacheKey = `${CACHE_NS}:list:v${version}:${JSON.stringify({ page, limit, sort, search: query.search || '' })}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const [docs, total] = await Promise.all([
      this.repository.findMany(filter, '', '', sort, limit, skip),
      this.repository.countDocuments(filter),
    ]);
    const response = formatPaginatedResponse(docs, total, page, limit);

    await setCache(cacheKey, response, 3600); // 1 hour
    return response;
  }

  async getCategoryById(id) {
    const cacheKey = `sticker_category:${id}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const category = await this.repository.findById(id);
    if (!category) throw new ApiError(404, 'Sticker category not found');

    await setCache(cacheKey, category, 3600);
    return category;
  }

  async updateCategory(id, data) {
    const updated = await this.repository.updateById(id, data);
    if (!updated) throw new ApiError(404, 'Sticker category not found');

    await Promise.all([
      deleteCache(`sticker_category:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return updated;
  }

  async toggleCategoryStatus(id) {
    // Atomic flip via aggregation-pipeline update
    const updated = await this.repository.updateById(
      id,
      [{ $set: { isActive: { $not: '$isActive' } } }],
      { new: true }
    );
    if (!updated) throw new ApiError(404, 'Sticker category not found');

    await Promise.all([
      deleteCache(`sticker_category:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return updated;
  }

  async deleteCategory(id) {
    // Guard against orphaned stickers
    const stickerCount = await stickerRepository.countDocuments({ categoryId: id });
    if (stickerCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete category: ${stickerCount} sticker(s) still belong to it. Delete or reassign them first.`
      );
    }

    const deleted = await this.repository.deleteById(id);
    if (!deleted) throw new ApiError(404, 'Sticker category not found');

    await Promise.all([
      deleteCache(`sticker_category:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return deleted;
  }
}

export default new StickerCategoryService();
