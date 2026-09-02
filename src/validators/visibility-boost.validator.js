import Joi from 'joi';

export const purchaseBoostSchema = Joi.object({
  body: Joi.object({
    idempotencyKey: Joi.string().trim().max(64).optional(),
  }),
});

export const updateBoostConfigSchema = Joi.object({
  body: Joi.object({
    isEnabled: Joi.boolean().optional(),
    priceCoins: Joi.number().integer().min(1).optional(),
    durationMinutes: Joi.number().integer().min(1).max(1440).optional(),
    maxActiveSlots: Joi.number().integer().min(1).max(100).optional(),
  }),
});
