import Joi from 'joi';

export const applyReferralSchema = {
  body: Joi.object().keys({
    inviteCode: Joi.string().trim().uppercase().required(),
  }),
};

export const updateReferralConfigSchema = {
  body: Joi.object().keys({
    referrerRewardCoins: Joi.number().min(0),
    referredRewardCoins: Joi.number().min(0),
    inviteLinkPrefix: Joi.string().trim(),
  }).min(1),
};

export const adminReferralsQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortOrder: Joi.string().valid('asc', 'desc'),
    status: Joi.string().valid('all', 'pending', 'rewarded'),
    q: Joi.string().trim().allow(''),
  }),
};
