import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const createOrUpdateReviewSchema = {
  body: Joi.object().keys({
    rating: Joi.number().integer().min(1).max(5).required(),
    reviewComment: Joi.string().trim().allow('', null),
  }),
};

export const listReviewsQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
  }),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

export const listenerIdParamSchema = {
  params: Joi.object().keys({
    listenerId: objectId.required(),
  }),
};
