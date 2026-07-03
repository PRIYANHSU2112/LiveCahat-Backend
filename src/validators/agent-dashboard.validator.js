import Joi from 'joi';

export const agentDashboardPeriodQuerySchema = {
  query: Joi.object({
    period: Joi.string().valid('24h', '7d', '30d').default('7d'),
  }),
};

export const agentDashboardActivityQuerySchema = {
  query: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(20),
    cursor: Joi.alternatives().try(Joi.string(), Joi.number()).default(0),
  }),
};
