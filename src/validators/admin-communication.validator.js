import Joi from 'joi';

const sessionModes = ['CHAT', 'AUDIO', 'VIDEO', 'all'];
const sessionStatuses = ['ONGOING', 'COMPLETED', 'MISSED', 'REJECTED', 'FAILED', 'INITIATED', 'all'];
const periods = ['today', '24h', '7d', '30d'];

export const adminCommunicationStatsQuerySchema = {
  query: Joi.object({
    mode: Joi.string().valid(...sessionModes).default('all'),
    period: Joi.string().valid(...periods).default('today'),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
  }),
};

export const adminCommunicationListQuerySchema = {
  query: Joi.object({
    mode: Joi.string().valid(...sessionModes).default('all'),
    status: Joi.string().valid(...sessionStatuses).default('all'),
    period: Joi.string().valid(...periods),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
    search: Joi.string().trim().max(120).allow(''),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().valid('createdAt', 'duration', 'totalCoinsSpent', 'status').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const adminCommunicationLiveQuerySchema = {
  query: Joi.object({
    mode: Joi.string().valid(...sessionModes).default('all'),
    limit: Joi.number().integer().min(1).max(100).default(50),
  }),
};

export const adminCommunicationSessionIdParamSchema = {
  params: Joi.object({
    sessionId: Joi.string().hex().length(24).required(),
  }),
};

export const updateCommunicationConfigSchema = {
  body: Joi.object({
    maxSessionDurationMinutes: Joi.number().integer().min(1).max(480),
    recordingEnabled: Joi.boolean(),
    messageRetentionDays: Joi.number().integer().min(1).max(3650),
    mediaSharingEnabled: Joi.boolean(),
    hdVideoDefault: Joi.boolean(),
    noiseCancellationEnabled: Joi.boolean(),
    maxVideoParticipants: Joi.number().integer().min(2).max(10),
  }).min(1),
};
