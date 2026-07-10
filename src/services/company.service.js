import companyRepository from '../repositories/company.repository.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';

const PROFILE_CACHE_KEY = 'company:profile';

const PROFILE_FIELDS = [
  'name',
  'email',
  'subEmail',
  'supportEmail',
  'phone',
  'phoneAlt',
  'supportPhone',
  'website',
  'address',
  'gstin',
  'cin',
  'logo',
  'favicon',
  'tagline',
  'description',
];

const POLICY_KEYS = [
  'privacyPolicy',
  'termsAndConditions',
  'refundPolicy',
  'aboutUs',
  'contactUs',
];

const SOCIAL_KEYS = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube'];

function mapCompanyRow(doc) {
  if (!doc) return null;
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    id: row._id?.toString() ?? row.id,
    name: row.name,
    logo: row.logo,
    favicon: row.favicon,
    tagline: row.tagline,
    description: row.description,
    email: row.email,
    subEmail: row.subEmail,
    phone: row.phone,
    phoneAlt: row.phoneAlt,
    address: row.address,
    website: row.website,
    socialLinks: row.socialLinks ?? {},
    policies: row.policies ?? {},
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    gstin: row.gstin,
    cin: row.cin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function countFilled(obj = {}, keys = []) {
  return keys.reduce((n, key) => {
    const val = obj[key];
    return n + (val && String(val).trim() ? 1 : 0);
  }, 0);
}

function computeStats(company) {
  if (!company) {
    return {
      lastUpdatedAt: null,
      hasLogo: false,
      hasFavicon: false,
      policiesFilled: 0,
      socialLinksFilled: 0,
      profileCompleteness: 0,
    };
  }

  const policies = company.policies ?? {};
  const socialLinks = company.socialLinks ?? {};
  const profileFilled = countFilled(company, PROFILE_FIELDS);
  const policiesFilled = countFilled(policies, POLICY_KEYS);
  const socialLinksFilled = countFilled(socialLinks, SOCIAL_KEYS);
  const totalTracked = PROFILE_FIELDS.length + POLICY_KEYS.length + SOCIAL_KEYS.length;
  const filled = profileFilled + policiesFilled + socialLinksFilled;

  return {
    lastUpdatedAt: company.updatedAt ?? null,
    hasLogo: Boolean(company.logo?.trim()),
    hasFavicon: Boolean(company.favicon?.trim()),
    policiesFilled,
    socialLinksFilled,
    profileCompleteness: Math.round((filled / totalTracked) * 100),
  };
}

class CompanyService {
  async findPrimaryRecord() {
    return companyRepository.findPrimary();
  }

  async clearProfileCache() {
    await deleteCache(PROFILE_CACHE_KEY);
  }

  async createCompany(data) {
    const company = await companyRepository.create(data);
    await this.clearProfileCache();
    return mapCompanyRow(company);
  }

  async getCompanyProfile() {
    let company = await getCache(PROFILE_CACHE_KEY);
    if (company) return company;

    let doc = await this.findPrimaryRecord();
    if (!doc) {
      doc = await companyRepository.create({
        name: 'Default Company Name',
        email: 'info@company.com',
        description: 'Company description goes here.',
      });
    }

    company = mapCompanyRow(doc);
    await setCache(PROFILE_CACHE_KEY, company, 3600);
    return company;
  }

  async getAdminProfile() {
    const doc = await this.findPrimaryRecord();
    if (!doc) {
      throw new ApiError(404, 'Company profile not found. Save settings to create one.');
    }
    return mapCompanyRow(doc);
  }

  async getAdminStats() {
    const doc = await this.findPrimaryRecord();
    return computeStats(doc ? mapCompanyRow(doc) : null);
  }

  async upsertAdminProfile(data) {
    const existing = await this.findPrimaryRecord();
    let doc;
    if (existing) {
      doc = await companyRepository.updateById(existing._id, { $set: data }, { new: true, runValidators: true });
    } else {
      const payload = { name: data.name?.trim() || 'My Company', ...data };
      doc = await companyRepository.create(payload);
    }
    await this.clearProfileCache();
    return mapCompanyRow(doc);
  }

  async getAllCompanies(query) {
    const limit = parseInt(query.limit, 10) || 10;
    const skip = (parseInt(query.page, 10) - 1) * limit || 0;
    const docs = await companyRepository.findMany({}, '', '', { createdAt: -1 }, limit, skip);
    return docs.map(mapCompanyRow);
  }

  async getCompanyById(id) {
    const company = await companyRepository.findById(id);
    if (!company) {
      throw new ApiError(404, 'Company not found');
    }
    return mapCompanyRow(company);
  }

  async updateCompany(id, data) {
    const updatedCompany = await companyRepository.updateById(id, { $set: data });
    if (!updatedCompany) {
      throw new ApiError(404, 'Company not found');
    }
    await this.clearProfileCache();
    return mapCompanyRow(updatedCompany);
  }

  async deleteCompany(id) {
    const deletedCompany = await companyRepository.deleteById(id);
    if (!deletedCompany) {
      throw new ApiError(404, 'Company not found');
    }
    await this.clearProfileCache();
    return mapCompanyRow(deletedCompany);
  }
}

export default new CompanyService();
