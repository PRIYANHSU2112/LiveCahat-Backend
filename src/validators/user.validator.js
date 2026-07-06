import Joi from 'joi';
import { GENDERS } from '../constants/enum.constant.js';

export const updateUserProfileSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().trim().min(2).max(50),
    lastName: Joi.string().trim().min(2).max(50),
    email: Joi.string().email().allow(null, ''),
    gender: Joi.string().valid(...GENDERS),
    dateOfBirth: Joi.date().iso().max(new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000)).message('You must be at least 18 years old'),
  })
});

export const updateSettingsSchema = Joi.object({
  body: Joi.object({
    notifications: Joi.boolean(),
    acceptIncomingCalls: Joi.boolean(),
    dndChats: Joi.boolean(),
    dndVoiceCall: Joi.boolean(),
    dndVideoCall: Joi.boolean(),
  }).min(1),
});

export const queryUserSchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().allow('', null),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    type: Joi.string().valid('CUSTOMER', 'LISTENER', 'ADMIN', 'AGENT'),
    isBlocked: Joi.boolean(),
  })
});

export const blockUserSchema = Joi.object({
  body: Joi.object({
    isBlocked: Joi.boolean().required(),
  })
});

export const createAdminSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().required().trim(),
    lastName: Joi.string().required().trim(),
    email: Joi.string().email().required().trim().lowercase(),
    password: Joi.string().min(6).required(),
    mobileNumber: Joi.string().required().trim(),
    roleId: Joi.string().hex().length(24).required(),
  })
});

export const createListenerSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().required().trim(),
    lastName: Joi.string().required().trim(),
    mobileNumber: Joi.string().required().trim(),
    dateOfBirth: Joi.date().iso().max(new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000)).message('Listener must be at least 18 years old').required(),
    gender: Joi.string().valid(...GENDERS).required(),
  })
});

export const createAgentSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().required().trim(),
    lastName: Joi.string().required().trim(),
    email: Joi.string().email().required().trim().lowercase(),
    password: Joi.string().min(6).required(),
    mobileNumber: Joi.string().required().trim(),
    commissionPercentage: Joi.number().min(0).max(100).default(0),
  })
});

export const paginationQuerySchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
});

export const verifyCustomerSchema = Joi.object({
  body: Joi.object({
    action: Joi.string().valid('approve', 'reject').required(),
    reason: Joi.string().trim().max(500).when('action', {
      is: 'reject',
      then: Joi.optional(),
      otherwise: Joi.forbidden(),
    }),
  }),
});
