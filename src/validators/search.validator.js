import Joi from 'joi';
import {
  AVAILABILITY_STATUSES,
  KYC_STATUSES,
  USER_TYPES,
  GENDERS,
  LISTENER_CATEGORIES,
} from '../constants/enum.constant.js';

export const agentSearchQuerySchema = Joi.object({
  query: Joi.object({
    q: Joi.string().trim().min(2).max(100).allow(''),
    country: Joi.string().trim().max(50),
    accountStatus: Joi.string().valid('active', 'blocked', 'pending'),
    kycStatus: Joi.string().valid(...KYC_STATUSES),
    liveStatus: Joi.string().valid(...AVAILABILITY_STATUSES),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(20),
  }).or('q', 'country', 'accountStatus', 'kycStatus', 'liveStatus'),
});

export const adminSearchQuerySchema = Joi.object({
  query: Joi.object({
    q: Joi.string().trim().min(2).max(100),
    type: Joi.string().valid(...USER_TYPES),
    country: Joi.string().trim().max(10),
    language: Joi.string().trim().max(50),
    gender: Joi.string().valid(...GENDERS),
    isBlocked: Joi.string().valid('true', 'false'),
    isDeleted: Joi.string().valid('true', 'false'),
    dateFrom: Joi.string().trim().max(40),
    dateTo: Joi.string().trim().max(40),
    kycStatus: Joi.string().valid(...KYC_STATUSES),
    availability: Joi.string().valid(...AVAILABILITY_STATUSES),
    category: Joi.string().valid(...LISTENER_CATEGORIES),
    minEarnings: Joi.number(),
    maxEarnings: Joi.number(),
    minRating: Joi.number().min(1).max(5),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(50),
    sortBy: Joi.string().trim().max(50),
    sortOrder: Joi.string().valid('asc', 'desc'),
    compact: Joi.boolean(),
  }),
});
