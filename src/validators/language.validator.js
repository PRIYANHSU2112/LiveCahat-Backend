import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const createLanguageSchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    code: Joi.string().required().trim().min(2).max(10),
    nativeName: Joi.string().trim().allow('', null),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateLanguageSchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    code: Joi.string().trim().min(2).max(10),
    nativeName: Joi.string().trim().allow('', null),
    isActive: Joi.boolean(),
  }).min(1),
};

export const listLanguageQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('name', 'code', 'createdAt'),
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
