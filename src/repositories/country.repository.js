import BaseRepository from './base.repository.js';
import Country from '../modules/country.model.js';

class CountryRepository extends BaseRepository {
  constructor() {
    super(Country);
  }

  async findActiveMany(filter = {}, sort = { name: 1 }) {
    return await Country.find({ ...filter, isActive: true }).sort(sort).lean();
  }

  /**
   * Resolve a country from the dialing code sent at login/register (e.g. "+91").
   * Tolerates a missing leading "+".
   */
  async findByDialCode(dialCode) {
    if (!dialCode) return null;
    const normalized = dialCode.startsWith('+') ? dialCode : `+${dialCode}`;
    return await this.findOne({ dialCode: normalized, isActive: true });
  }

  async findByCode(code) {
    if (!code) return null;
    return await this.findOne({ code: code.toUpperCase(), isActive: true });
  }
}

export default new CountryRepository();
