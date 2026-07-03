import Joi from 'joi';

export const agentAnalyticsRevenueQuerySchema = {
  query: Joi.object({
    period: Joi.string().valid('month', '3months', '6months', 'year').default('6months'),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
  }),
};

export const agentAnalyticsListenersQuerySchema = {
  query: Joi.object({
    period: Joi.string().valid('3months', '6months', '12months').default('6months'),
  }),
};

export const agentAnalyticsRetentionQuerySchema = {
  query: Joi.object({
    cohortMonths: Joi.number().integer().valid(3, 6, 12).default(6),
  }),
};

export const agentAnalyticsPeriodReportQuerySchema = {
  query: Joi.object({
    period: Joi.string().valid('daily', 'weekly', 'monthly').default('daily'),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
  }),
};
