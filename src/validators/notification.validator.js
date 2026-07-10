import Joi from 'joi';
import { NOTIFICATION_TYPES, NOTIFICATION_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);
// notification.metadata is a Map<string, string> on the model
const metadata = Joi.object().pattern(Joi.string(), Joi.string());

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
};

export const listNotificationQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
    status: Joi.string().valid(...NOTIFICATION_STATUSES),
    type: Joi.string().valid(...NOTIFICATION_TYPES),
  }),
};

export const adminListNotificationQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
    status: Joi.string().valid(...NOTIFICATION_STATUSES),
    type: Joi.string().valid(...NOTIFICATION_TYPES),
    search: Joi.string().trim().allow(''),
    ...dateFilterFields,
  }),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

export const sendNotificationSchema = {
  body: Joi.object().keys({
    recipientId: objectId.required(),
    title: Joi.string().trim().min(1).max(140).required(),
    body: Joi.string().trim().min(1).max(1000).required(),
    type: Joi.string().valid(...NOTIFICATION_TYPES).default('SYSTEM'),
    metadata,
  }),
};

export const broadcastNotificationSchema = {
  body: Joi.object().keys({
    // CUSTOMER → all users · LISTENER → all listeners · AGENT → all agents · ALL → everyone
    audience: Joi.string().valid('CUSTOMER', 'LISTENER', 'AGENT', 'ALL').required(),
    title: Joi.string().trim().min(1).max(140).required(),
    body: Joi.string().trim().min(1).max(1000).required(),
    type: Joi.string().valid(...NOTIFICATION_TYPES).default('SYSTEM'),
    metadata,
  }),
};
