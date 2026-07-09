import Joi from 'joi';
import { XP_ACTIONS, LEVEL_REWARD_TYPES } from '../constants/enum.constant.js';

// ═══════════════════════════════════════════════════════════════════
// Level Config Validators
// ═══════════════════════════════════════════════════════════════════

export const createLevelConfigSchema = {
  body: Joi.object().keys({
    level: Joi.number().integer().min(1).required(),
    xpRequired: Joi.number().integer().min(0).required(),
    title: Joi.string().required().trim(),
    badge: Joi.string().allow('', null).trim(),
    rewards: Joi.array().items(Joi.string().hex().length(24)).default([]),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateLevelConfigSchema = {
  body: Joi.object().keys({
    level: Joi.number().integer().min(1),
    xpRequired: Joi.number().integer().min(0),
    title: Joi.string().trim(),
    badge: Joi.string().allow('', null).trim(),
    rewards: Joi.array().items(Joi.string().hex().length(24)),
    isActive: Joi.boolean(),
  }),
};

// ═══════════════════════════════════════════════════════════════════
// Reward Validators
// ═══════════════════════════════════════════════════════════════════

export const createRewardSchema = {
  body: Joi.object().keys({
    type: Joi.string().valid(...LEVEL_REWARD_TYPES).required(),
    value: Joi.number().min(0).default(1),
    referenceId: Joi.string().hex().length(24).allow(null).default(null),
    label: Joi.string().required().trim(),
    icon: Joi.string().allow('', null).trim(),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateRewardSchema = {
  body: Joi.object().keys({
    type: Joi.string().valid(...LEVEL_REWARD_TYPES),
    value: Joi.number().min(0),
    referenceId: Joi.string().hex().length(24).allow(null),
    label: Joi.string().trim(),
    icon: Joi.string().allow('', null).trim(),
    isActive: Joi.boolean(),
  }),
};

// ═══════════════════════════════════════════════════════════════════
// XP Action Config Validators
// ═══════════════════════════════════════════════════════════════════

export const updateXpActionSchema = {
  body: Joi.object().keys({
    xp: Joi.number().integer().min(0),
    isActive: Joi.boolean(),
    label: Joi.string().trim(),
  }),
};

// ═══════════════════════════════════════════════════════════════════
// Reward Inventory Validators
// ═══════════════════════════════════════════════════════════════════

export const rewardInventoryQuerySchema = {
  query: Joi.object().keys({
    status: Joi.string().valid('UNCLAIMED', 'CLAIMED'),
  }),
};

export const claimRewardSchema = {
  params: Joi.object().keys({
    inventoryId: Joi.string().hex().length(24).required(),
  }),
};

// ═══════════════════════════════════════════════════════════════════
// Admin Grant XP Validator
// ═══════════════════════════════════════════════════════════════════

export const adminGrantXpSchema = {
  body: Joi.object().keys({
    userId: Joi.string().hex().length(24).required(),
    xpAmount: Joi.number().integer().min(1).required(),
    reason: Joi.string().trim().default('Admin manual grant'),
  }),
};

export const adminTransactionsQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    userId: Joi.string().hex().length(24),
    action: Joi.string().valid(...XP_ACTIONS),
    adminGrant: Joi.boolean(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const adminRewardClaimsQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    userId: Joi.string().hex().length(24),
    status: Joi.string().valid('UNCLAIMED', 'CLAIMED'),
    level: Joi.number().integer().min(1),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};
