import Joi from 'joi';
import { AVAILABILITY_STATUSES, KYC_STATUSES } from '../constants/enum.constant.js';

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
