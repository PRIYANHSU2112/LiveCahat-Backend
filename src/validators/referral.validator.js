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
