import Joi from 'joi';
import { ANCHOR_REQUIREMENT_TYPES, ANCHOR_REWARD_TYPES, REWARD_CLAIM_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

const rewardItem = Joi.object().keys({
  type: Joi.string().valid(...ANCHOR_REWARD_TYPES).required(),
  value: Joi.number().min(0).default(1),
  // referenceId required for GIFT, forbidden otherwise
  referenceId: Joi.when('type', {
    is: 'GIFT',
    then: objectId.required(),
    otherwise: objectId.allow(null),
  }),
  label: Joi.string().trim().allow('', null),
  icon: Joi.string().trim().allow('', null),
});

export const createLevelSchema = {
  body: Joi.object().keys({
    level: Joi.number().integer().min(1).required(),
    title: Joi.string().trim().required(),
    requirementType: Joi.string().valid(...ANCHOR_REQUIREMENT_TYPES).default('EARNINGS'),
    requiredEarnings: Joi.when('requirementType', {
      is: 'EARNINGS',
      then: Joi.number().min(0).required(),
      otherwise: Joi.number().min(0).default(0),
    }),
    badge: Joi.string().trim().allow('', null),
    rewards: Joi.array().items(rewardItem).default([]),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateLevelSchema = {
  body: Joi.object().keys({
    level: Joi.number().integer().min(1),
    title: Joi.string().trim(),
    requirementType: Joi.string().valid(...ANCHOR_REQUIREMENT_TYPES),
    requiredEarnings: Joi.number().min(0),
    badge: Joi.string().trim().allow('', null),
    rewards: Joi.array().items(rewardItem),
    isActive: Joi.boolean(),
  }).min(1),
};

export const adminLevelsQuerySchema = {
  query: Joi.object().keys({
    q: Joi.string().trim().allow(''),
    isActive: Joi.boolean(),
  }),
};

export const claimsQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
    userId: objectId,
    status: Joi.string().valid(...REWARD_CLAIM_STATUSES),
  }),
};

export const inventoryQuerySchema = {
  query: Joi.object().keys({
    status: Joi.string().valid(...REWARD_CLAIM_STATUSES),
  }),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};
