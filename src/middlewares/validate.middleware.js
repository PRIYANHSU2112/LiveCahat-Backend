import Joi from 'joi';
import ApiError from '../utils/ApiError.js';

export const validate = (schema) => (req, res, next) => {
  const validSchema = Joi.isSchema(schema) ? schema : Joi.object(schema);
  const object = {};
  
  if (schema.body) object.body = req.body;
  if (schema.query) object.query = req.query;
  if (schema.params) object.params = req.params;

  const { value, error } = validSchema.validate(object, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    const errorMessage = error.details.map((details) => details.message).join(', ');
    return next(new ApiError(400, errorMessage));
  }

  if (value.body) req.body = value.body;
  if (value.query) req.query = value.query;
  if (value.params) req.params = value.params;

  return next();
};
