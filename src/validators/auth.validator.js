import Joi from 'joi';

export const requestOtpSchema = Joi.object({
  body: Joi.object({
    type: Joi.string().valid('CUSTOMER', 'LISTENER').required(),
    mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required(),
    countryCode: Joi.string().default('+91'),
  })
});

export const verifyOtpSchema = Joi.object({
  body: Joi.object({
    type: Joi.string().valid('CUSTOMER', 'LISTENER').required(),
    mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required(),
    otp: Joi.string().length(6).required(),
    countryCode: Joi.string().default('+91'),
  })
});

export const adminLoginSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  })
});
