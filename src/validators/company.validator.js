import Joi from 'joi';

const audienceLegalWithRefund = Joi.object().keys({
  privacyPolicy: Joi.string().allow('', null),
  termsAndConditions: Joi.string().allow('', null),
  refundPolicy: Joi.string().allow('', null),
});

const agentLegal = Joi.object().keys({
  privacyPolicy: Joi.string().allow('', null),
  termsAndConditions: Joi.string().allow('', null),
});

const policiesSchema = Joi.object().keys({
  app: audienceLegalWithRefund,
  listener: audienceLegalWithRefund,
  agent: agentLegal,
  aboutUs: Joi.string().allow('', null),
  contactUs: Joi.string().allow('', null),
});

const socialLinksSchema = Joi.object().keys({
  facebook: Joi.string().allow('', null),
  instagram: Joi.string().allow('', null),
  twitter: Joi.string().allow('', null),
  linkedin: Joi.string().allow('', null),
  youtube: Joi.string().allow('', null),
});

const companyBodyKeys = {
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
  socialLinks: socialLinksSchema,
  policies: policiesSchema,
  supportEmail: Joi.string().email().allow('', null),
  supportPhone: Joi.string().allow('', null),
  gstin: Joi.string().allow('', null),
  cin: Joi.string().allow('', null),
};

export const createCompanySchema = {
  body: Joi.object()
    .keys({
      ...companyBodyKeys,
      name: Joi.string().required().trim(),
      socialLinks: socialLinksSchema.default({}),
      policies: policiesSchema.default({}),
    }),
};

export const updateCompanySchema = {
  body: Joi.object().keys(companyBodyKeys),
};

export const legalAudienceParamSchema = {
  params: Joi.object().keys({
    audience: Joi.string().valid('app', 'listener', 'agent').required(),
  }),
};
