import Joi from 'joi';

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso(),
};

export const adminDashboardQuerySchema = {
  query: Joi.object(dateFilterFields),
};

export const adminDashboardListQuerySchema = {
  query: Joi.object({
    ...dateFilterFields,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow('').max(128),
  }),
};
