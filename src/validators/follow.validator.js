import Joi from 'joi';

/**
 * Follow validators — Joi schemas for request validation.
 */

export const listenerIdParamSchema = Joi.object({
  params: Joi.object({
    listenerId: Joi.string().hex().length(24).required()
      .messages({ 'string.length': 'listenerId must be a valid 24-character ObjectId' }),
  }),
});

export const userIdParamSchema = Joi.object({
  params: Joi.object({
    userId: Joi.string().hex().length(24).required()
      .messages({ 'string.length': 'userId must be a valid 24-character ObjectId' }),
  }),
});

export const paginationSchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
});

export const followersListSchema = Joi.object({
  params: Joi.object({
    listenerId: Joi.string().hex().length(24).required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
});

export const topFollowedSchema = Joi.object({
  query: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(10),
  }),
});
