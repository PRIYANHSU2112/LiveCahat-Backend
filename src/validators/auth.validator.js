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
    inviteCode: Joi.string().trim().uppercase().allow('', null),
  })
});

export const loginSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  })
});


export const guestLoginSchema = Joi.object({
  body: Joi.object({
    deviceId: Joi.string().trim().min(8).max(128).required(),
    dateOfBirth: Joi.date().iso().required(),
    inviteCode: Joi.string().trim().uppercase().allow('', null),
  })
});

export const linkAccountSchema = Joi.object({
  body: Joi.object({
    mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required(),
    otp: Joi.string().length(6).required(),
    countryCode: Joi.string().default('+91'),
  })
});
