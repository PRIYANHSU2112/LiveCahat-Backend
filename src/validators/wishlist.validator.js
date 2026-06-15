import Joi from 'joi';

export const listenerIdParamSchema = {
  params: Joi.object({
    listenerId: Joi.string().hex().length(24).required().messages({
      'string.length': 'listenerId must be a valid 24-character hex ObjectId',
    }),
  })
};

export const paginationSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
  })
};
