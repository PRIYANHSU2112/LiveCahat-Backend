import Joi from 'joi';

const packFields = {
  name: Joi.string().required().trim(),
  coins: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0).required(),
  currency: Joi.string().trim().uppercase().default('INR'),
  badge: Joi.string().trim().allow('', null),
  description: Joi.string().trim().allow('', null),
  referralBonusCoins: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true),
};

export const createCoinPackSchema = {
  body: Joi.object().keys(packFields),
};

export const updateCoinPackSchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    coins: Joi.number().integer().min(1),
    price: Joi.number().min(0),
    currency: Joi.string().trim().uppercase(),
    badge: Joi.string().trim().allow('', null),
    description: Joi.string().trim().allow('', null),
    referralBonusCoins: Joi.number().integer().min(0),
    isActive: Joi.boolean(),
  }),
};

export const adminCoinPackListQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    q: Joi.string().trim().allow(''),
    isActive: Joi.boolean(),
    sortBy: Joi.string().valid('createdAt', 'name', 'coins', 'price').default('price'),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};
