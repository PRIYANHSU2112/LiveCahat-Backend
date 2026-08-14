import companyRepository from '../repositories/company.repository.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';

const PROFILE_CACHE_KEY = 'company:profile';
const LEGAL_AUDIENCES = ['app', 'listener', 'agent'];

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

const APP_LISTENER_POLICY_KEYS = ['privacyPolicy', 'termsAndConditions', 'refundPolicy'];
const AGENT_POLICY_KEYS = ['privacyPolicy', 'termsAndConditions'];
const SHARED_POLICY_KEYS = ['aboutUs', 'contactUs'];
const TOTAL_POLICY_FIELDS =
  APP_LISTENER_POLICY_KEYS.length * 2 + AGENT_POLICY_KEYS.length + SHARED_POLICY_KEYS.length;

const SOCIAL_KEYS = ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube'];

function emptyAudiencePolicies(includeRefund = true) {
  const base = {
    privacyPolicy: '',
    termsAndConditions: '',
  };
  if (includeRefund) base.refundPolicy = '';
  return base;
}

function pickAudience(source = {}, includeRefund = true) {
  const keys = includeRefund ? APP_LISTENER_POLICY_KEYS : AGENT_POLICY_KEYS;
  const out = emptyAudiencePolicies(includeRefund);
  for (const key of keys) {
    if (source[key] != null) out[key] = String(source[key]);
  }
  return out;
}

/**
 * Normalize legacy flat policies + nested audience policies into the canonical shape.
 * Legacy flat privacy/terms/refund migrate into `app` when app fields are empty.
 */
export function normalizePolicies(raw = {}) {
  const legacyApp = {
    privacyPolicy: raw.privacyPolicy,
    termsAndConditions: raw.termsAndConditions,
    refundPolicy: raw.refundPolicy,
  };

  const appSource = raw.app && typeof raw.app === 'object' ? raw.app : {};
  const listenerSource = raw.listener && typeof raw.listener === 'object' ? raw.listener : {};
  const agentSource = raw.agent && typeof raw.agent === 'object' ? raw.agent : {};

  const app = pickAudience(appSource, true);
  const hasAppContent = APP_LISTENER_POLICY_KEYS.some((k) => String(app[k] || '').trim());
  if (!hasAppContent) {
    const fromLegacy = pickAudience(legacyApp, true);
    if (APP_LISTENER_POLICY_KEYS.some((k) => String(fromLegacy[k] || '').trim())) {
      Object.assign(app, fromLegacy);
    }
  }

  return {
    app,
    listener: pickAudience(listenerSource, true),
    agent: pickAudience(agentSource, false),
    aboutUs: raw.aboutUs != null ? String(raw.aboutUs) : '',
    contactUs: raw.contactUs != null ? String(raw.contactUs) : '',
  };
}

function countFilled(obj = {}, keys = []) {
  return keys.reduce((n, key) => {
    const val = obj[key];
    return n + (val && String(val).trim() ? 1 : 0);
  }, 0);
}

function countPoliciesFilled(policies) {
  const p = normalizePolicies(policies);
  return (
    countFilled(p.app, APP_LISTENER_POLICY_KEYS) +
    countFilled(p.listener, APP_LISTENER_POLICY_KEYS) +
    countFilled(p.agent, AGENT_POLICY_KEYS) +
    countFilled(p, SHARED_POLICY_KEYS)
  );
}

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
    policies: normalizePolicies(row.policies ?? {}),
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    gstin: row.gstin,
    cin: row.cin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function computeStats(company) {
  if (!company) {
    return {
      lastUpdatedAt: null,
      hasLogo: false,
      hasFavicon: false,
      policiesFilled: 0,
      policiesTotal: TOTAL_POLICY_FIELDS,
      socialLinksFilled: 0,
      profileCompleteness: 0,
    };
  }

  const policies = company.policies ?? {};
  const socialLinks = company.socialLinks ?? {};
  const profileFilled = countFilled(company, PROFILE_FIELDS);
  const policiesFilled = countPoliciesFilled(policies);
  const socialLinksFilled = countFilled(socialLinks, SOCIAL_KEYS);
  const totalTracked = PROFILE_FIELDS.length + TOTAL_POLICY_FIELDS + SOCIAL_KEYS.length;
  const filled = profileFilled + policiesFilled + socialLinksFilled;

  return {
    lastUpdatedAt: company.updatedAt ?? null,
    hasLogo: Boolean(company.logo?.trim()),
    hasFavicon: Boolean(company.favicon?.trim()),
    policiesFilled,
    policiesTotal: TOTAL_POLICY_FIELDS,
    socialLinksFilled,
    profileCompleteness: Math.round((filled / totalTracked) * 100),
  };
}

function prepareCompanyWritePayload(data = {}) {
  const payload = { ...data };
  if (data.policies !== undefined) {
    const normalized = normalizePolicies(data.policies);
    // Persist canonical nested shape; clear legacy flat keys so they do not re-surface.
    payload.policies = {
      ...normalized,
      privacyPolicy: '',
      termsAndConditions: '',
      refundPolicy: '',
    };
  }
  return payload;
}

class CompanyService {
  async findPrimaryRecord() {
    return companyRepository.findPrimary();
  }

  async clearProfileCache() {
    await deleteCache(PROFILE_CACHE_KEY);
  }

  async createCompany(data) {
    const company = await companyRepository.create(prepareCompanyWritePayload(data));
    await this.clearProfileCache();
    return mapCompanyRow(company);
  }

  async getCompanyProfile() {
    let company = await getCache(PROFILE_CACHE_KEY);
    if (company) {
      // Re-normalize in case cache still holds a legacy shape
      return {
        ...company,
        policies: normalizePolicies(company.policies ?? {}),
      };
    }

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

  async getLegalByAudience(audience) {
    const key = String(audience || '').toLowerCase();
    if (!LEGAL_AUDIENCES.includes(key)) {
      throw new ApiError(400, 'Invalid audience. Use app, listener, or agent.');
    }

    const company = await this.getCompanyProfile();
    const policies = company.policies ?? normalizePolicies({});
    const audienceDocs = policies[key] ?? emptyAudiencePolicies(key !== 'agent');

    const result = {
      audience: key,
      privacyPolicy: audienceDocs.privacyPolicy ?? '',
      termsAndConditions: audienceDocs.termsAndConditions ?? '',
      aboutUs: policies.aboutUs ?? '',
      contactUs: policies.contactUs ?? '',
    };

    if (key === 'app' || key === 'listener') {
      result.refundPolicy = audienceDocs.refundPolicy ?? '';
    }

    return result;
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
    const payload = prepareCompanyWritePayload(data);
    let doc;
    if (existing) {
      doc = await companyRepository.updateById(existing._id, { $set: payload }, { new: true, runValidators: true });
    } else {
      doc = await companyRepository.create({
        name: payload.name?.trim() || 'My Company',
        ...payload,
      });
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
    const updatedCompany = await companyRepository.updateById(id, {
      $set: prepareCompanyWritePayload(data),
    });
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
