import Joi from 'joi';

const paginationField = (name) =>
  Joi.number().integer().min(1).optional().label(name);

export const listenerHomeQuerySchema = Joi.object({
  query: Joi.object({
    section: Joi.string().valid('online', 'new', 'popular').optional(),
    onlinePage: paginationField('onlinePage'),
    onlineLimit: paginationField('onlineLimit'),
    newPage: paginationField('newPage'),
    newLimit: paginationField('newLimit'),
    popularPage: paginationField('popularPage'),
    popularLimit: paginationField('popularLimit'),
  }),
});
