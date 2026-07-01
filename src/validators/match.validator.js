import Joi from 'joi';
import { LISTENER_CATEGORIES, AVAILABILITY_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .message('{{#label}} must be a valid 24-character ObjectId');

const matchValidator = {
  updateMatchConfig: {
    body: Joi.object({
      instantMatchFee: Joi.number().min(0),
      isEnabled: Joi.boolean(),
    }).min(1),
  },

  instantMatch: {
    body: Joi.object({
      mode: Joi.string().valid('CHAT', 'AUDIO', 'VIDEO').default('CHAT'),
      language: Joi.string().trim().max(50),
      country: Joi.string().trim().max(50),
      category: Joi.string().valid(...LISTENER_CATEGORIES),
      excludeListenerIds: Joi.array().items(objectId).max(20).default([]),
      refresh: Joi.boolean().truthy('true').falsy('false').default(false),
    }),
  },

  matchStatus: {
    query: Joi.object({
      language: Joi.string().trim().max(50),
      country: Joi.string().trim().max(50),
      category: Joi.string().valid(...LISTENER_CATEGORIES),
    }),
  },

  discoverListeners: {
    query: Joi.object({
      page: Joi.number().integer().min(1),
      limit: Joi.number().integer().min(1).max(50),
      sort: Joi.string()
        .valid('combined', 'rating', 'anchor_level', 'featured', 'popular')
        .default('combined'),
      minRating: Joi.number().min(0).max(5),
      maxRating: Joi.number().min(0).max(5),
      minAnchorLevel: Joi.number().integer().min(0),
      maxAnchorLevel: Joi.number().integer().min(0),
      anchorLevel: Joi.number().integer().min(0),
      language: Joi.string().trim().max(50),
      country: Joi.string().trim().max(50),
      sameCountry: Joi.boolean().truthy('true').falsy('false').default(true),
      relaxCountry: Joi.boolean().truthy('true').falsy('false').default(false),
      category: Joi.string().valid(...LISTENER_CATEGORIES),
      status: Joi.string().valid(...AVAILABILITY_STATUSES),
      q: Joi.string().trim().max(100).allow(''),
    }),
  },
};

export default matchValidator;
