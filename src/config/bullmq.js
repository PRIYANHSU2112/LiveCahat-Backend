import config from './index.js';

/**
 * BullMQ requires dedicated connection options with maxRetriesPerRequest: null.
 */
export const bullRedisConnection = {
  host: config.redis.host,
  port: Number(config.redis.port) || 6379,
  password: config.redis.password || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Standard enterprise job configuration.
 */
export const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s backoff
  },
  removeOnComplete: {
    count: 1000,
    age: 24 * 3600, // Keep up to 1,000 completed jobs / 24 hrs
  },
  removeOnFail: {
    count: 5000,
    age: 7 * 24 * 3600, // Keep up to 5,000 failed jobs / 7 days for diagnostics
  },
};
