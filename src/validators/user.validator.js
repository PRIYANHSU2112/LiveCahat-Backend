import Joi from 'joi';
import { GENDERS } from '../constants/enum.constant.js';

export const updateUserProfileSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().trim().min(2).max(50),
    lastName: Joi.string().trim().min(2).max(50),
    email: Joi.string().email().allow(null, ''),
    gender: Joi.string().valid(...GENDERS),
    age: Joi.number().integer().min(18).max(120).messages({
      'number.min': 'You must be at least 18 years old',
    }),
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
    year: Joi.number().integer().min(2020).max(2100),
    month: Joi.number().integer().min(1).max(12),
    day: Joi.number().integer().min(1).max(31),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
  }),
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
    age: Joi.number().integer().min(18).max(120).required().messages({
      'number.min': 'Listener must be at least 18 years old',
    }),
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
    aadhaarFront: Joi.string().uri().required(),
    aadhaarBack: Joi.string().uri().required(),
  }),
});

export const updateAgentSchema = Joi.object({
  body: Joi.object({
    firstName: Joi.string().trim().min(2).max(50),
    lastName: Joi.string().trim().min(2).max(50),
    email: Joi.string().email().trim().lowercase(),
    mobileNumber: Joi.string().trim(),
    commissionPercentage: Joi.number().min(0).max(100),
    password: Joi.string().min(6),
    aadhaarFront: Joi.string().uri(),
    aadhaarBack: Joi.string().uri(),
  }).min(1),
});

export const paginationQuerySchema = Joi.object({
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
});

export const agentAdminStatsQuerySchema = Joi.object({
  query: Joi.object({
    year: Joi.number().integer().min(2020).max(2100),
    month: Joi.number().integer().min(1).max(12),
    day: Joi.number().integer().min(1).max(31),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
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
