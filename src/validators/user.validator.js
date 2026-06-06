import Joi from 'joi';

/**
 * Defines Joi schemas to validate incoming requests.
 * Used alongside a validation middleware.
 */
export const registerUserSchema = Joi.object({
  body: Joi.object({
    name: Joi.string().required().min(3).max(50),
    email: Joi.string().required().email(),
    password: Joi.string().required().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/)
      .message('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  })
});
