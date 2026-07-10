import Joi from 'joi';
import { GENDERS } from '../constants/enum.constant.js';

const ageField = Joi.number()
  .integer()
  .min(18)
  .max(120)
  .required()
  .messages({
    'number.min': 'You must be at least 18 years old',
    'number.base': 'Age must be a number',
  });

const genderField = Joi.when('type', {
  is: 'LISTENER',
  then: Joi.string()
    .valid('FEMALE')
    .required()
    .messages({ 'any.only': 'Listeners must select female gender' }),
  otherwise: Joi.string().valid(...GENDERS).required(),
});

export const requestOtpSchema = Joi.object({
  body: Joi.object({
    type: Joi.string().valid('CUSTOMER', 'LISTENER').required(),
    mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required(),
    countryCode: Joi.string().default('+91'),
    age: ageField,
    gender: genderField,
  }),
});

export const verifyOtpSchema = Joi.object({
  body: Joi.object({
    type: Joi.string().valid('CUSTOMER', 'LISTENER').required(),
    mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required(),
    otp: Joi.string().trim().length(6).required(),
    countryCode: Joi.string().default('+91'),
    age: ageField.optional(),
    gender: Joi.when('type', {
      is: 'LISTENER',
      then: Joi.string().valid('FEMALE').optional(),
      otherwise: Joi.string().valid(...GENDERS).optional(),
    }),
    inviteCode: Joi.string().trim().uppercase().allow('', null),
  }),
});

export const loginSchema = Joi.object({
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),
});

export const guestLoginSchema = Joi.object({
  body: Joi.object({
    deviceId: Joi.string().trim().min(8).max(128).required(),
    age: ageField,
    inviteCode: Joi.string().trim().uppercase().allow('', null),
  }),
});

export const linkAccountSchema = Joi.object({
  body: Joi.object({
    mobileNumber: Joi.string().pattern(/^[0-9]{10}$/).required(),
    otp: Joi.string().trim().length(6).required(),
    countryCode: Joi.string().default('+91'),
  }),
});
