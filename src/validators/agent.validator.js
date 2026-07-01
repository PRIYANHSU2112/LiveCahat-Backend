import Joi from 'joi';

export const agentRevenueSummaryQuerySchema = {
  query: Joi.object({
    period: Joi.string().valid('today', 'week', 'month').default('month'),
  }),
};

export const agentRevenueGraphsQuerySchema = {
  query: Joi.object({
    period: Joi.string().valid('6months', '3months').default('6months'),
  }),
};

export const agentRevenueHistoryQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(50),
    source: Joi.string().valid('all', 'gift', 'call').default('all'),
    status: Joi.string().valid('all', 'paid', 'pending').default('all'),
  }),
};
