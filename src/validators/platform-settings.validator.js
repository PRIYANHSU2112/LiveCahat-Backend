import Joi from 'joi';

export const updatePlatformSettingsSchema = {
  body: Joi.object({
    maintenanceMode: Joi.boolean(),
    allowRegistrations: Joi.boolean(),
    defaultLanguage: Joi.string().trim().min(2).max(16),
    featureFlags: Joi.object().unknown(true),
  }).min(1),
};
