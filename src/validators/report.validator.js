import Joi from 'joi';
import { REPORT_STATUSES } from '../constants/enum.constant.js';

const objectId = Joi.string().hex().length(24);

const dateFilterFields = {
  year: Joi.number().integer().min(2020).max(2100),
  month: Joi.number().integer().min(1).max(12),
  day: Joi.number().integer().min(1).max(31),
};

export const createReportReasonSchema = {
  body: Joi.object({
    label: Joi.string().trim().min(2).max(120).required(),
    description: Joi.string().trim().max(500).allow('', null),
    sortOrder: Joi.number().integer().min(0).default(0),
  }),
};

export const updateReportReasonSchema = {
  body: Joi.object({
    label: Joi.string().trim().min(2).max(120),
    description: Joi.string().trim().max(500).allow('', null),
    sortOrder: Joi.number().integer().min(0),
  }).min(1),
};

export const toggleReportReasonSchema = {
  body: Joi.object({
    isActive: Joi.boolean(),
  }),
};

export const listReportReasonsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('sortOrder', 'label', 'createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    isActive: Joi.boolean(),
    search: Joi.string().trim().allow(''),
  }),
};

export const createReportSchema = {
  body: Joi.object({
    targetId: objectId.required(),
    reasonIds: Joi.array().items(objectId.required()).min(1).unique().required(),
    message: Joi.string().trim().min(10).max(1000).required(),
    sessionId: objectId,
  }),
};

export const listReportsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().valid('createdAt', 'status'),
    sortOrder: Joi.string().valid('asc', 'desc'),
    status: Joi.string().valid(...REPORT_STATUSES),
    reasonId: objectId,
    reporterType: Joi.string().valid('CUSTOMER', 'LISTENER'),
    targetType: Joi.string().valid('CUSTOMER', 'LISTENER'),
    search: Joi.string().trim().allow(''),
    ...dateFilterFields,
  }),
};

export const reportStatsQuerySchema = {
  query: Joi.object(dateFilterFields),
};

export const moderateReportSchema = {
  body: Joi.object({
    status: Joi.string().valid(...REPORT_STATUSES),
    adminNote: Joi.string().trim().max(1000).allow('', null),
    blockTarget: Joi.boolean(),
  }).min(1),
};

export const idParamSchema = {
  params: Joi.object({
    id: objectId.required(),
  }),
};
