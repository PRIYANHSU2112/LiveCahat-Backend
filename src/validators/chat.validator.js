import Joi from 'joi';

export const conversationListQuerySchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    search: Joi.string().trim().max(100).allow('', null),
  }),
});

export const sessionIdParamSchema = Joi.object({
  params: Joi.object({
    sessionId: Joi.string().hex().length(24).required()
      .messages({ 'string.length': 'sessionId must be a valid 24-character ObjectId' }),
  }),
});
