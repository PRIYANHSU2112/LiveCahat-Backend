import countryRepository from '../repositories/country.repository.js';
import User from '../modules/user.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion } from '../utils/redis.util.js';

const CACHE_KEY_ACTIVE = 'countries:active';
const CACHE_NS = 'countries';

const normalizeDialCode = (dialCode) => {
  if (!dialCode) return dialCode;
  return dialCode.startsWith('+') ? dialCode : `+${dialCode}`;
};

const normalizeCountryPayload = (data) => {
  const payload = { ...data };
  if (payload.code) payload.code = payload.code.toUpperCase();
  if (payload.dialCode) payload.dialCode = normalizeDialCode(payload.dialCode);
  if (payload.flagUrl === '') payload.flagUrl = null;
  return payload;
};

class CountryService {
  async invalidateCache() {
    await Promise.all([
      deleteCache(CACHE_KEY_ACTIVE),
      bumpCacheVersion(CACHE_NS),
    ]);
  }

  /**
   * List active countries for pickers (register screen, filters).
   * Cached for 1 hour — the list rarely changes.
   */
  async getActiveCountries() {
    const cached = await getCache(CACHE_KEY_ACTIVE);
    if (cached) return cached;

    const countries = await countryRepository.findActiveMany({}, { name: 1 });
    await setCache(CACHE_KEY_ACTIVE, countries, 3600);
    return countries;
  }

  async getAdminStats() {
    const [total, active, inactive, usersLinked, listenersLinked] = await Promise.all([
      countryRepository.countDocuments({}),
      countryRepository.countDocuments({ isActive: true }),
      countryRepository.countDocuments({ isActive: false }),
      User.countDocuments({ country: { $exists: true, $ne: null } }),
      ListenerProfile.countDocuments({ country: { $exists: true, $ne: null } }),
    ]);
    return { total, active, inactive, usersLinked, listenersLinked };
  }

  async getAdminCountries(query = {}) {
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
        { dialCode: { $regex: term, $options: 'i' } },
      ];
    }
    if (query.isActive !== undefined) filter.isActive = query.isActive;

    const [docs, total] = await Promise.all([
      countryRepository.findMany(filter, '', '', sort, limit, skip),
      countryRepository.countDocuments(filter),
    ]);
    return formatPaginatedResponse(docs, total, page, limit);
  }

  async getCountryById(id) {
    const country = await countryRepository.findById(id);
    if (!country) {
      throw new ApiError(404, 'Country not found');
    }
    return country;
  }

  async createCountry(data) {
    const payload = normalizeCountryPayload(data);

    const [existingCode, existingDial] = await Promise.all([
      countryRepository.findOne({ code: payload.code }),
      countryRepository.findOne({ dialCode: payload.dialCode }),
    ]);
    if (existingCode) throw new ApiError(400, 'Country with this ISO code already exists');
    if (existingDial) throw new ApiError(400, 'Country with this dial code already exists');

    const country = await countryRepository.create(payload);
    await this.invalidateCache();
    return country;
  }

  async updateCountry(id, data) {
    const payload = normalizeCountryPayload(data);

    if (payload.code) {
      const existing = await countryRepository.findOne({ code: payload.code, _id: { $ne: id } });
      if (existing) throw new ApiError(400, 'Country with this ISO code already exists');
    }
    if (payload.dialCode) {
      const existing = await countryRepository.findOne({ dialCode: payload.dialCode, _id: { $ne: id } });
      if (existing) throw new ApiError(400, 'Country with this dial code already exists');
    }

    const updated = await countryRepository.updateById(id, payload);
    if (!updated) throw new ApiError(404, 'Country not found');

    await this.invalidateCache();
    return updated;
  }

  async toggleCountryStatus(id) {
    const updated = await countryRepository.updateById(
      id,
      [{ $set: { isActive: { $not: '$isActive' } } }],
      { new: true },
    );
    if (!updated) throw new ApiError(404, 'Country not found');

    await this.invalidateCache();
    return updated;
  }

  async deleteCountry(id) {
    const [usersLinked, listenersLinked] = await Promise.all([
      User.countDocuments({ country: id }),
      ListenerProfile.countDocuments({ country: id }),
    ]);
    if (usersLinked > 0 || listenersLinked > 0) {
      throw new ApiError(400, 'Cannot delete country linked to users or listeners');
    }

    const deleted = await countryRepository.deleteById(id);
    if (!deleted) throw new ApiError(404, 'Country not found');

    await this.invalidateCache();
    return deleted;
  }
}

export default new CountryService();
