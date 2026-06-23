import Joi from 'joi';
import { PAYMENT_METHOD_TYPES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_PATTERN = /^[\w.\-]+@[\w]+$/;

export const createBankAccountSchema = {
  body: Joi.object().keys({
    methodType: Joi.string().valid(...PAYMENT_METHOD_TYPES).required(),
    // BANK fields — required only when methodType is BANK
    bankName: Joi.when('methodType', {
      is: 'BANK',
      then: Joi.string().trim().required(),
      otherwise: Joi.forbidden(),
    }),
    accountHolderName: Joi.when('methodType', {
      is: 'BANK',
      then: Joi.string().trim().required(),
      otherwise: Joi.forbidden(),
    }),
    accountNumber: Joi.when('methodType', {
      is: 'BANK',
      then: Joi.string().trim().pattern(/^[0-9]{6,18}$/).required(),
      otherwise: Joi.forbidden(),
    }),
    ifscCode: Joi.when('methodType', {
      is: 'BANK',
      then: Joi.string().trim().uppercase().pattern(IFSC_PATTERN).required(),
      otherwise: Joi.forbidden(),
    }),
    // UPI fields — required only when methodType is UPI
    upiId: Joi.when('methodType', {
      is: 'UPI',
      then: Joi.string().trim().pattern(UPI_PATTERN).required(),
      otherwise: Joi.forbidden(),
    }),
    payeeName: Joi.when('methodType', {
      is: 'UPI',
      then: Joi.string().trim().required(),
      otherwise: Joi.forbidden(),
    }),
    isDefault: Joi.boolean().default(false),
  }),
};

export const idParamSchema = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};
