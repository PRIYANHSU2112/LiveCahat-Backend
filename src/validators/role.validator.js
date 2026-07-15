import Joi from 'joi';
import { PERMISSION_CODES, MATRIX_MODULES, MATRIX_ACTIONS } from '../constants/permission.constant.js';

export const listRolesQuerySchema = {
  query: Joi.object({
    search: Joi.string().allow('').max(100),
    isActive: Joi.string().valid('true', 'false'),
  }),
};

export const createRoleSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(80).required(),
    slug: Joi.string().trim().lowercase().max(80),
    description: Joi.string().trim().allow('').max(300),
    permissions: Joi.array().items(Joi.string().valid(...PERMISSION_CODES)).default([]),
    isActive: Joi.boolean().default(true),
  }),
};

export const updateRoleSchema = {
  params: Joi.object({ id: Joi.string().hex().length(24).required() }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(80),
    description: Joi.string().trim().allow('').max(300),
    permissions: Joi.array().items(Joi.string().valid(...PERMISSION_CODES)),
    isActive: Joi.boolean(),
  }).min(1),
};

export const roleIdParamSchema = {
  params: Joi.object({ id: Joi.string().hex().length(24).required() }),
};

export const putMatrixSchema = {
  params: Joi.object({ id: Joi.string().hex().length(24).required() }),
  body: Joi.object({
    cells: Joi.array()
      .items(
        Joi.object({
          module: Joi.string()
            .valid(...MATRIX_MODULES)
            .required(),
          action: Joi.string()
            .valid(...MATRIX_ACTIONS)
            .required(),
          granted: Joi.boolean().required(),
        })
      )
      .required(),
  }),
};

export const assignAdminRoleSchema = {
  params: Joi.object({ id: Joi.string().hex().length(24).required() }),
  body: Joi.object({
    roleId: Joi.string().hex().length(24).required(),
  }),
};

export const listAuditLogsQuerySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    search: Joi.string().allow('').max(100),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc'),
  }),
};
