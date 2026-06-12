import Joi from 'joi';

export const createCompanySchema = {
  body: Joi.object().keys({
    name: Joi.string().required().trim(),
    logo: Joi.string().allow('', null),
    favicon: Joi.string().allow('', null),
    tagline: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    subEmail: Joi.string().email().allow('', null),
    phone: Joi.string().allow('', null),
    phoneAlt: Joi.string().allow('', null),
    address: Joi.string().allow('', null),
    website: Joi.string().allow('', null),
    socialLinks: Joi.object().keys({
      facebook: Joi.string().allow('', null),
      instagram: Joi.string().allow('', null),
      twitter: Joi.string().allow('', null),
      linkedin: Joi.string().allow('', null),
      youtube: Joi.string().allow('', null),
    }).default({}),
    policies: Joi.object().keys({
      privacyPolicy: Joi.string().allow('', null),
      termsAndConditions: Joi.string().allow('', null),
      refundPolicy: Joi.string().allow('', null),
      aboutUs: Joi.string().allow('', null),
      contactUs: Joi.string().allow('', null),
    }).default({}),
    supportEmail: Joi.string().email().allow('', null),
    supportPhone: Joi.string().allow('', null),
    gstin: Joi.string().allow('', null),
    cin: Joi.string().allow('', null),
  })
};

export const updateCompanySchema = {
  body: Joi.object().keys({
    name: Joi.string().trim(),
    logo: Joi.string().allow('', null),
    favicon: Joi.string().allow('', null),
    tagline: Joi.string().allow('', null),
    description: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    subEmail: Joi.string().email().allow('', null),
    phone: Joi.string().allow('', null),
    phoneAlt: Joi.string().allow('', null),
    address: Joi.string().allow('', null),
    website: Joi.string().allow('', null),
    socialLinks: Joi.object().keys({
      facebook: Joi.string().allow('', null),
      instagram: Joi.string().allow('', null),
      twitter: Joi.string().allow('', null),
      linkedin: Joi.string().allow('', null),
      youtube: Joi.string().allow('', null),
    }),
    policies: Joi.object().keys({
      privacyPolicy: Joi.string().allow('', null),
      termsAndConditions: Joi.string().allow('', null),
      refundPolicy: Joi.string().allow('', null),
      aboutUs: Joi.string().allow('', null),
      contactUs: Joi.string().allow('', null),
    }),
    supportEmail: Joi.string().email().allow('', null),
    supportPhone: Joi.string().allow('', null),
    gstin: Joi.string().allow('', null),
    cin: Joi.string().allow('', null),
  })
};
