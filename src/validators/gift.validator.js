import Joi from 'joi';

export const createGiftSchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    coin: Joi.number().integer().min(0).required(),
    earningPercent: Joi.number().min(0).max(100).default(70),
    adminPercent: Joi.number().min(0).max(100).default(30),
    icon: Joi.string().required().trim(),
    category: Joi.string().valid('REGULAR', 'PREMIUM', '18+', 'SPECIAL').default('REGULAR'),
    description: Joi.string().allow('', null).trim(),
  })
};

export const updateGiftSchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    coin: Joi.number().integer().min(0),
    earningPercent: Joi.number().min(0).max(100),
    adminPercent: Joi.number().min(0).max(100),
    icon: Joi.string().trim(),
    category: Joi.string().valid('REGULAR', 'PREMIUM', '18+', 'SPECIAL'),
    isActive: Joi.boolean(),
    description: Joi.string().allow('', null).trim(),
  })
};

export const sendGiftSchema = {
  body: Joi.object().keys({
    giftId: Joi.string().hex().length(24).required().messages({
      'string.length': 'giftId must be a valid 24-character ObjectId',
    }),
    receiverId: Joi.string().hex().length(24).required().messages({
      'string.length': 'receiverId must be a valid 24-character ObjectId',
    }),
  })
};

export const queryGiftSchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    category: Joi.string().valid('REGULAR', 'PREMIUM', '18+', 'SPECIAL'),
    isActive: Joi.boolean(),
  })
};
