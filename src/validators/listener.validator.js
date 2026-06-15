import Joi from 'joi';
import { LISTENER_CATEGORIES, AVAILABILITY_STATUSES, KYC_STATUSES } from '../constants/enum.constant.js';

export const updateListenerProfileSchema = Joi.object({
  body: Joi.object({
    bio: Joi.string().trim().max(500),
    categories: Joi.array().items(Joi.string().valid(...LISTENER_CATEGORIES)),
    languages: Joi.array().items(Joi.string().hex().length(24)), // Array of ObjectIds
    interests: Joi.array().items(Joi.string().trim().max(100)).optional(),
    // profilePhotos: Joi.array().items(Joi.string()),
    // introVideo: Joi.string().trim().allow('', null),
  })
});

export const updateRatesSchema = Joi.object({
  body: Joi.object({
    chatRate: Joi.number().min(0),
    voiceRate: Joi.number().min(0),
    videoRate: Joi.number().min(0),
  })
});

export const updateAvailabilitySchema = Joi.object({
  body: Joi.object({
    availability: Joi.string().valid(...AVAILABILITY_STATUSES).required(),
  })
});

export const updateKycStatusSchema = Joi.object({
  body: Joi.object({
    kycStatus: Joi.string().valid(...KYC_STATUSES).required(),
    rejectionReason: Joi.string().when('kycStatus', {
      is: 'REJECTED',
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
  })
});
