import Joi from 'joi';
import { SETTLEMENT_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
};

export const listAgentSettlementsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    status: Joi.string().valid('all', 'completed', 'pending', 'failed', ...SETTLEMENT_STATUSES).default('all'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    agentId: objectId,
    ...dateFilterFields,
  }),
};

export const adminListSettlementsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    status: Joi.string().valid('all', 'completed', 'pending', 'failed', ...SETTLEMENT_STATUSES).default('all'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    agentId: objectId,
    ...dateFilterFields,
  }),
};

export const runSettlementsSchema = {
  body: Joi.object({
    agentId: objectId,
    weeksAgo: Joi.number().integer().min(1).max(12).default(1),
  }),
};
