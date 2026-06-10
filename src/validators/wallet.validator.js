import Joi from 'joi';
import { WALLET_STATUSES, COIN_TRANSACTION_TYPES, COIN_REFERENCE_TYPES } from '../constants/enum.constant.js';

export const getTransactionsSchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    type: Joi.string().trim(),
    status: Joi.string().trim(),
    userId: Joi.string().hex().length(24),
  })
});

export const adminCreditDebitSchema = Joi.object({
  body: Joi.object({
    amount: Joi.number().integer().positive().required(),
    type: Joi.string().valid(...COIN_TRANSACTION_TYPES).required(),
    referenceType: Joi.string().valid('BONUS', 'PENALTY').required(),
    description: Joi.string().trim().max(500).allow('', null),
  })
});

export const adminUpdateWalletStatusSchema = Joi.object({
  body: Joi.object({
    status: Joi.string().valid(...WALLET_STATUSES).required(),
  })
});

export const getWalletsSchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    status: Joi.string().valid(...WALLET_STATUSES),
    search: Joi.string().allow('', null),
  })
});
