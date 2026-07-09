import Joi from 'joi';
import { WALLET_STATUSES, COIN_TRANSACTION_TYPES, COIN_REFERENCE_TYPES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
};

export const getTransactionsSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    type: Joi.string().valid(...COIN_TRANSACTION_TYPES),
    status: Joi.string().trim(),
    userId: objectId,
    referenceType: Joi.string().valid(...COIN_REFERENCE_TYPES),
    ...dateFilterFields,
  }),
};

export const adminCreditDebitSchema = {
  body: Joi.object({
    amount: Joi.number().integer().positive().required(),
    type: Joi.string().valid(...COIN_TRANSACTION_TYPES).required(),
    referenceType: Joi.string().valid('BONUS', 'PENALTY').required(),
    description: Joi.string().trim().max(500).allow('', null),
  }),
};

export const adminUpdateWalletStatusSchema = {
  body: Joi.object({
    status: Joi.string().valid(...WALLET_STATUSES).required(),
  }),
};

export const getWalletsSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    status: Joi.string().valid(...WALLET_STATUSES),
    search: Joi.string().allow('', null),
    ...dateFilterFields,
  }),
};

export const adminStatsQuerySchema = {
  query: Joi.object(dateFilterFields),
};

export const idParamSchema = {
  params: Joi.object({
    id: objectId.required(),
  }),
};

export const userIdParamSchema = {
  params: Joi.object({
    userId: objectId.required(),
  }),
};
