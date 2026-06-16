import Joi from 'joi';

export const createAvatarSchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    image: Joi.string().required().trim(),
    priceType: Joi.string().valid('FREE', 'PAID').default('FREE'),
    price: Joi.number().min(0).default(0),
    category: Joi.string().valid('REGULAR', 'PREMIUM', 'SPECIAL').default('REGULAR'),
    isActive: Joi.boolean().default(true),
  })
};

export const updateAvatarSchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    image: Joi.string().trim(),
    priceType: Joi.string().valid('FREE', 'PAID'),
    price: Joi.number().min(0),
    category: Joi.string().valid('REGULAR', 'PREMIUM', 'SPECIAL'),
    isActive: Joi.boolean(),
  })
};
