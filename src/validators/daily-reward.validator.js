import Joi from 'joi';

export const updateDaysConfigSchema = {
  body: Joi.object().keys({
    configs: Joi.array().items(
      Joi.object().keys({
        day: Joi.number().integer().min(1).max(7).required(),
        rewardType: Joi.string().valid('COINS', 'GIFT', 'WEEKLY_SPECIAL_GIFT').required(),
        rewardValue: Joi.number().integer().min(0).default(0),
        giftId: Joi.string().hex().length(24).allow(null, '').default(null),
      })
    ).length(7).required()
  })
};

export const updateWeeksConfigSchema = {
  body: Joi.object().keys({
    configs: Joi.array().items(
      Joi.object().keys({
        week: Joi.number().integer().min(1).max(4).required(),
        giftId: Joi.string().hex().length(24).required()
      })
    ).length(4).required()
  })
};
