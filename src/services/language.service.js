import languageRepository from '../repositories/language.repository.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

const CACHE_NS = 'languages';

class LanguageService {
  async createLanguage(data) {
    if (data.code) {
      const existing = await languageRepository.findOne({ code: data.code.toUpperCase() });
      if (existing) {
        throw new ApiError(400, 'Language with this code already exists');
      }
    }
    const language = await languageRepository.create(data);
    await bumpCacheVersion(CACHE_NS);
    return language;
  }

  async getAdminStats() {
    const [total, active, inactive, listenerProfilesUsing] = await Promise.all([
      languageRepository.countDocuments({}),
      languageRepository.countDocuments({ isActive: true }),
      languageRepository.countDocuments({ isActive: false }),
      ListenerProfile.countDocuments({ languages: { $exists: true, $ne: [] } }),
    ]);
    return { total, active, inactive, listenerProfilesUsing };
  }

  /**
   * Paginated language listing.
   * Admin: live data, full isActive filter, search on name/code/nativeName.
   * User: active only, version-keyed cache.
   */
  async getAllLanguages(query = {}, forAdmin = false) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'name',
      sortOrder: 'asc',
      ...query,
    });

    const filter = {};
    if (query.search) {
      const term = query.search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { code: { $regex: term, $options: 'i' } },
        { nativeName: { $regex: term, $options: 'i' } },
      ];
    }

    if (forAdmin) {
      if (query.isActive !== undefined) filter.isActive = query.isActive;

      const [docs, total] = await Promise.all([
        languageRepository.findMany(filter, '', '', sort, limit, skip),
        languageRepository.countDocuments(filter),
      ]);
      return formatPaginatedResponse(docs, total, page, limit);
    }

    filter.isActive = true;

    const version = await getCacheVersion(CACHE_NS);
    const cacheKey = `${CACHE_NS}:list:v${version}:${JSON.stringify({ page, limit, sort, search: query.search || '' })}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const [docs, total] = await Promise.all([
      languageRepository.findMany(filter, '', '', sort, limit, skip),
      languageRepository.countDocuments(filter),
    ]);
    const response = formatPaginatedResponse(docs, total, page, limit);

    await setCache(cacheKey, response, 3600);
    return response;
  }

  async getLanguageById(id) {
    const cacheKey = `language:${id}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const language = await languageRepository.findById(id);
    if (!language) {
      throw new ApiError(404, 'Language not found');
    }

    await setCache(cacheKey, language, 3600);
    return language;
  }

  async updateLanguage(id, data) {
    if (data.code) {
      const existing = await languageRepository.findOne({ code: data.code.toUpperCase(), _id: { $ne: id } });
      if (existing) {
        throw new ApiError(400, 'Language with this code already exists');
      }
    }
    const updatedLanguage = await languageRepository.updateById(id, data);
    if (!updatedLanguage) {
      throw new ApiError(404, 'Language not found');
    }

    await Promise.all([
      deleteCache(`language:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return updatedLanguage;
  }

  async toggleLanguageStatus(id) {
    const updated = await languageRepository.updateById(
      id,
      [{ $set: { isActive: { $not: '$isActive' } } }],
      { new: true },
    );
    if (!updated) {
      throw new ApiError(404, 'Language not found');
    }

    await Promise.all([
      deleteCache(`language:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return updated;
  }

  async deleteLanguage(id) {
    const inUse = await ListenerProfile.countDocuments({ languages: id });
    if (inUse > 0) {
      throw new ApiError(400, 'Cannot delete language in use by listeners');
    }

    const deletedLanguage = await languageRepository.deleteById(id);
    if (!deletedLanguage) {
      throw new ApiError(404, 'Language not found');
    }

    await Promise.all([
      deleteCache(`language:${id}`),
      bumpCacheVersion(CACHE_NS),
    ]);
    return deletedLanguage;
  }
}

export default new LanguageService();
