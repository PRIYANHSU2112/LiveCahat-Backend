import Joi from 'joi';

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
};

export const adminAnalyticsQuerySchema = {
  query: Joi.object(dateFilterFields),
};
