import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const createCountrySchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    code: Joi.string().required().trim().length(2).uppercase(),
    dialCode: Joi.string().required().trim().pattern(/^\+?\d{1,4}$/),
    flagUrl: Joi.string().trim().uri().allow('', null),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateCountrySchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    code: Joi.string().trim().length(2).uppercase(),
    dialCode: Joi.string().trim().pattern(/^\+?\d{1,4}$/),
    flagUrl: Joi.string().trim().uri().allow('', null),
    isActive: Joi.boolean(),
  }).min(1),
};

export const listCountryQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('name', 'code', 'dialCode', 'createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    search: Joi.string().trim().allow(''),
    isActive: Joi.boolean(),
  }),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};
