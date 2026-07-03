import Joi from 'joi';
import { SETTLEMENT_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

export const listAgentSettlementsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    status: Joi.string().valid('all', 'completed', 'pending', 'failed', ...SETTLEMENT_STATUSES).default('all'),
    sortOrder: Joi.string().valid('asc', 'desc'),
  }),
};

export const runSettlementsSchema = {
  body: Joi.object({
    agentId: objectId,
    weeksAgo: Joi.number().integer().min(1).max(12).default(1),
  }),
};
