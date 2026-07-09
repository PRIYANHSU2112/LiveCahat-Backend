import Joi from 'joi';

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
};

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

export const adminStatsQuerySchema = {
  query: Joi.object().keys(dateFilterFields),
};

export const adminClaimsQuerySchema = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    userId: Joi.string().hex().length(24),
    rewardType: Joi.string().valid('COINS', 'GIFT'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    ...dateFilterFields,
  }),
};
