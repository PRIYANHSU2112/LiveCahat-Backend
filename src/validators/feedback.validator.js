import Joi from 'joi';
import { USER_TYPES, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

export const createFeedbackSchema = {
  body: Joi.object().keys({
    category: Joi.string().valid(...FEEDBACK_CATEGORIES).default('OTHER'),
    message: Joi.string().required().trim(),
    rating: Joi.number().integer().min(1).max(5),
  }),
};

export const updateFeedbackSchema = {
  body: Joi.object().keys({
    category: Joi.string().valid(...FEEDBACK_CATEGORIES),
    message: Joi.string().trim(),
    rating: Joi.number().integer().min(1).max(5),
  }).min(1),
};

export const moderateFeedbackSchema = {
  body: Joi.object().keys({
    status: Joi.string().valid(...FEEDBACK_STATUSES),
    adminResponse: Joi.string().trim().allow('', null),
  }).min(1),
};

export const listFeedbackQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
    category: Joi.string().valid(...FEEDBACK_CATEGORIES),
    status: Joi.string().valid(...FEEDBACK_STATUSES),
    userType: Joi.string().valid(...USER_TYPES),
    search: Joi.string().trim().allow(''),
  }),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};
