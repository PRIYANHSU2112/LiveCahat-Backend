import Joi from 'joi';
import { LISTENER_CATEGORIES, AVAILABILITY_STATUSES, KYC_STATUSES } from '../constants/enum.constant.js';
import { PERIODS } from '../utils/date.util.js';

export const updateListenerProfileSchema = Joi.object({
  body: Joi.object({
    bio: Joi.string().trim().max(500),
    categories: Joi.array().items(Joi.string().valid(...LISTENER_CATEGORIES)),
    languages: Joi.array().items(Joi.string().hex().length(24)), // Array of ObjectIds
    interests: Joi.array().items(Joi.string().trim().max(100)).optional(),
    // profilePhotos: Joi.array().items(Joi.string()),
    // introVideo: Joi.string().trim().allow('', null),
  })
});

export const updateRatesSchema = Joi.object({
  body: Joi.object({
    chatRate: Joi.number().min(0),
    voiceRate: Joi.number().min(0),
    videoRate: Joi.number().min(0),
  })
});

export const updateAvailabilitySchema = Joi.object({
  body: Joi.object({
    availability: Joi.string().valid(...AVAILABILITY_STATUSES).required(),
  })
});

export const updateKycStatusSchema = Joi.object({
  body: Joi.object({
    kycStatus: Joi.string().valid(...KYC_STATUSES).required(),
    rejectionReason: Joi.string().when('kycStatus', {
      is: 'REJECTED',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
  })
});

export const homeListenersQuerySchema = Joi.object({
  query: Joi.object({
    q: Joi.string().trim().max(100).allow(''),
    language: Joi.string().trim().max(50), // ObjectId, name, or code
    country: Joi.string().trim().max(5), // countryCode e.g. "IN"
    status: Joi.string().valid(...AVAILABILITY_STATUSES), // ONLINE | OFFLINE | BUSY
    minRating: Joi.number().min(0).max(5),
    sort: Joi.string().valid('featured', 'popular', 'rating', 'newest').default('featured'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(50),
  }),
});

export const dashboardOverviewQuerySchema = Joi.object({
  query: Joi.object({
    period: Joi.string().valid(...PERIODS).default('today'),
  })
});

export const dashboardSessionsQuerySchema = Joi.object({
  query: Joi.object({
    period: Joi.string().valid(...PERIODS).default('today'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
  })
});

export const agentListenersQuerySchema = Joi.object({
  query: Joi.object({
    search: Joi.string().trim().max(100).allow(''),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
    country: Joi.string().trim().max(50), // ObjectId, ISO code, or name
    kycStatus: Joi.string().valid(...KYC_STATUSES),
    accountStatus: Joi.string().valid('active', 'blocked', 'pending'),
    level: Joi.number().integer().min(0), // anchor level (0 = no anchor level reached)
    liveStatus: Joi.string().valid(...AVAILABILITY_STATUSES), // ONLINE | OFFLINE | BUSY
    profileStatus: Joi.string().valid('incomplete', 'completed'),
    minRevenue: Joi.number().min(0),
    maxRevenue: Joi.number().min(0),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('createdAt', 'totalEarnings', 'availability', 'kycStatus'),
    sortOrder: Joi.string().valid('asc', 'desc'),
  }),
});

export const agentCreateListenerSchema = Joi.object({
  body: Joi.object({
    name: Joi.string().required().trim(),
    username: Joi.string().required().trim(),
    email: Joi.string().email().required().trim().lowercase(),
    phone: Joi.string().trim().allow('', null),
    country: Joi.string().trim().default('India'),
    profileStatus: Joi.string().valid('incomplete', 'completed').default('completed'),
  })
});

