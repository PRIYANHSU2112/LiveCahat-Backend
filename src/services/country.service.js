import countryRepository from '../repositories/country.repository.js';
import { getCache, setCache } from '../utils/redis.util.js';

class CountryService {
  /**
   * List active countries for pickers (register screen, filters).
   * Cached for 1 hour — the list rarely changes.
   */
  async getActiveCountries() {
    const cacheKey = 'countries:active';
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const countries = await countryRepository.findMany({ isActive: true }, { name: 1 });
    await setCache(cacheKey, countries, 3600);
    return countries;
  }
}

export default new CountryService();
