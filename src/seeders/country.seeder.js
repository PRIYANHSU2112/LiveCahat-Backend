import Country from '../modules/country.model.js';
import logger from '../utils/logger.util.js';

/**
 * Idempotent seeder for supported countries.
 * Safe to call on every server boot — only inserts countries that don't exist.
 * Dial codes are kept distinct so a login `countryCode` resolves to exactly one country.
 */
const COUNTRIES = [
  { name: 'India', code: 'IN', dialCode: '+91', flagUrl: 'https://flagcdn.com/in.svg' },
  { name: 'United States', code: 'US', dialCode: '+1', flagUrl: 'https://flagcdn.com/us.svg' },
  { name: 'United Kingdom', code: 'GB', dialCode: '+44', flagUrl: 'https://flagcdn.com/gb.svg' },
  { name: 'United Arab Emirates', code: 'AE', dialCode: '+971', flagUrl: 'https://flagcdn.com/ae.svg' },
  { name: 'Australia', code: 'AU', dialCode: '+61', flagUrl: 'https://flagcdn.com/au.svg' },
];

export const seedCountries = async () => {
  try {
    for (const country of COUNTRIES) {
      const exists = await Country.findOne({ code: country.code });
      if (!exists) {
        await Country.create(country);
        logger.info(`[Country Seeder] Created country: ${country.name} (${country.code} ${country.dialCode})`);
      }
    }
  } catch (err) {
    logger.error(`[Country Seeder Error] ${err.message}`);
  }
};
