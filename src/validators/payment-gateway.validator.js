import Joi from 'joi';
import { PAYMENT_GATEWAY_PROVIDERS, PAYMENT_GATEWAY_MODES } from '../constants/settings.constant.js';

const objectId = Joi.string().hex().length(24);

export const createPaymentGatewaySchema = {
  body: Joi.object({
    provider: Joi.string()
      .valid(...PAYMENT_GATEWAY_PROVIDERS)
      .required(),
    displayName: Joi.string().trim().max(80).required(),
    mode: Joi.string()
      .valid(...PAYMENT_GATEWAY_MODES)
      .default('sandbox'),
    isEnabled: Joi.boolean().default(false),
    isDefault: Joi.boolean().default(false),
    publicKey: Joi.string().trim().allow('').max(256),
    merchantId: Joi.string().trim().allow('').max(256),
    secret: Joi.string().trim().min(1).max(512),
    webhookSecret: Joi.string().trim().min(1).max(512),
    config: Joi.object().unknown(true),
  }),
};

export const updatePaymentGatewaySchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    displayName: Joi.string().trim().max(80),
    mode: Joi.string().valid(...PAYMENT_GATEWAY_MODES),
    isEnabled: Joi.boolean(),
    isDefault: Joi.boolean(),
    publicKey: Joi.string().trim().allow('').max(256),
    merchantId: Joi.string().trim().allow('').max(256),
    secret: Joi.string().trim().min(1).max(512),
    webhookSecret: Joi.string().trim().min(1).max(512),
    config: Joi.object().unknown(true),
  }).min(1),
};

export const paymentGatewayIdParamSchema = {
  params: Joi.object({ id: objectId.required() }),
};

export const paymentGatewayStatusSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    isEnabled: Joi.boolean().required(),
  }),
};
