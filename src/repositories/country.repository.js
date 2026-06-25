import Country from '../modules/country.model.js';

class CountryRepository {
  async create(data) {
    return await Country.create(data);
  }

  async findById(id, select = '', lean = true) {
    let query = Country.findById(id).select(select);
    if (lean) query = query.lean();
    return await query;
  }

  async findOne(filter, select = '', lean = true) {
    let query = Country.findOne(filter).select(select);
    if (lean) query = query.lean();
    return await query;
  }

  async findMany(filter = {}, sort = { name: 1 }) {
    return await Country.find(filter).sort(sort).lean();
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

  async countDocuments(filter = {}) {
    return await Country.countDocuments(filter);
  }
}

export default new CountryRepository();
