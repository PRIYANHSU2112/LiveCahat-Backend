import Joi from 'joi';
import { STICKER_UNLOCK_TYPES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

// ═══════════════════════════════════════════════════════════════════
// Sticker Category Validators
// ═══════════════════════════════════════════════════════════════════

export const createCategorySchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    slug: Joi.string().trim().lowercase().allow('', null),
    icon: Joi.string().trim().allow('', null),
    description: Joi.string().trim().allow('', null),
    sortOrder: Joi.number().integer().default(0),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateCategorySchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    slug: Joi.string().trim().lowercase().allow('', null),
    icon: Joi.string().trim().allow('', null),
    description: Joi.string().trim().allow('', null),
    sortOrder: Joi.number().integer(),
    isActive: Joi.boolean(),
  }).min(1),
};

export const listCategoryQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('sortOrder', 'name', 'createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    search: Joi.string().trim().allow(''),
    isActive: Joi.boolean(),
  }),
};

// ═══════════════════════════════════════════════════════════════════
// Sticker Validators
// ═══════════════════════════════════════════════════════════════════

export const createStickerSchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    image: Joi.string().required().trim(),
    categoryId: objectId.required(),
    tags: Joi.array().items(Joi.string().trim().lowercase()).default([]),
    unlockType: Joi.string().valid(...STICKER_UNLOCK_TYPES).default('FREE'),
    // price required (and > 0) only for PAID; forbidden otherwise
    price: Joi.when('unlockType', {
      is: 'PAID',
      then: Joi.number().min(1).required(),
      otherwise: Joi.number().min(0).default(0),
    }),
    // requiredLevel required only for LEVEL; defaults to 1 otherwise
    requiredLevel: Joi.when('unlockType', {
      is: 'LEVEL',
      then: Joi.number().integer().min(2).required(),
      otherwise: Joi.number().integer().min(1).default(1),
    }),
    sortOrder: Joi.number().integer().default(0),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateStickerSchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    image: Joi.string().trim(),
    categoryId: objectId,
    tags: Joi.array().items(Joi.string().trim().lowercase()),
    unlockType: Joi.string().valid(...STICKER_UNLOCK_TYPES),
    price: Joi.number().min(0),
    requiredLevel: Joi.number().integer().min(1),
    sortOrder: Joi.number().integer(),
    isActive: Joi.boolean(),
  }).min(1),
};

export const listStickerQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('sortOrder', 'name', 'createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    search: Joi.string().trim().allow(''),
    categoryId: objectId,
    unlockType: Joi.string().valid(...STICKER_UNLOCK_TYPES),
    isActive: Joi.boolean(),
  }),
};

// ═══════════════════════════════════════════════════════════════════
// Shared param validator
// ═══════════════════════════════════════════════════════════════════

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};
