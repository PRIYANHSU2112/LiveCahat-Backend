import Joi from 'joi';
import { WITHDRAWAL_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

export const quoteQuerySchema = {
  query: Joi.object().keys({
    coins: Joi.number().integer().min(1).required(),
  }),
};

export const createWithdrawalSchema = {
  body: Joi.object().keys({
    coins: Joi.number().integer().min(1).required(),
    bankAccountId: objectId.required(),
  }),
};

export const listWithdrawalQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
    status: Joi.string().valid(...WITHDRAWAL_STATUSES),
    userId: objectId,
  }),
};

export const rejectWithdrawalSchema = {
  body: Joi.object().keys({
    reason: Joi.string().trim().min(3).required(),
  }),
};

export const updateWithdrawalConfigSchema = {
  body: Joi.object().keys({
    conversionCoins: Joi.number().integer().min(1),
    conversionInr: Joi.number().min(0),
    feePercentage: Joi.number().min(0).max(100),
    minWithdrawalCoins: Joi.number().integer().min(1),
  }).min(1),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};
