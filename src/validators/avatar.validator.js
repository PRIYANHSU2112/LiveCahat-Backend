import Joi from 'joi';

const imageField = Joi.string().trim().uri().messages({
  'string.uri': 'image must be a valid URL',
});

export const createAvatarSchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    image: imageField,
    imageUrl: imageField,
    priceType: Joi.string().valid('FREE', 'PAID').default('FREE'),
    price: Joi.number().min(0).default(0),
    category: Joi.string().valid('REGULAR', 'PREMIUM', 'SPECIAL').default('REGULAR'),
    isActive: Joi.boolean().default(true),
  }).or('image', 'imageUrl'),
};

export const updateAvatarSchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    image: imageField,
    imageUrl: imageField,
    priceType: Joi.string().valid('FREE', 'PAID'),
    price: Joi.number().min(0),
    category: Joi.string().valid('REGULAR', 'PREMIUM', 'SPECIAL'),
    isActive: Joi.boolean(),
  }).unknown(true),
};

export const adminAvatarListQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    q: Joi.string().trim().allow(''),
    category: Joi.string().valid('REGULAR', 'PREMIUM', 'SPECIAL'),
    priceType: Joi.string().valid('FREE', 'PAID'),
    isActive: Joi.boolean(),
    sortBy: Joi.string().valid('createdAt', 'name', 'price').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};
