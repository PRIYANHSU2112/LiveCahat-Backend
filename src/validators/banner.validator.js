import Joi from 'joi';

export const createBannerSchema = {
  body: Joi.object({
    title: Joi.string().trim().allow(null, '').optional(),
    imageUrl: Joi.string().uri().required(),
    linkUrl: Joi.string().uri().trim().allow(null, '').optional(),
    position: Joi.number().integer().min(0).default(0).optional(),
    isActive: Joi.boolean().default(true).optional(),
  })
};

export const updateBannerSchema = {
  body: Joi.object({
    title: Joi.string().trim().allow(null, '').optional(),
    imageUrl: Joi.string().uri().optional(),
    linkUrl: Joi.string().uri().trim().allow(null, '').optional(),
    position: Joi.number().integer().min(0).optional(),
    isActive: Joi.boolean().optional(),
  })
};

export const toggleActiveSchema = {
  body: Joi.object({
    isActive: Joi.boolean().required(),
  })
};
