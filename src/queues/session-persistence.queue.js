import { Queue } from 'bullmq';
import { bullRedisConnection, defaultJobOptions } from '../config/bullmq.js';
import logger from '../utils/logger.util.js';

export const SESSION_PERSISTENCE_QUEUE_NAME = 'session_persistence';

export const SESSION_JOBS = {
  SESSION_STARTED: 'session:started',
  SESSION_ENDED: 'session:ended',
  SESSION_SEGMENT_SWITCHED: 'session:segment:switched',
};

/**
 * BullMQ Session Persistence Queue Instance
 */
export const sessionPersistenceQueue = new Queue(SESSION_PERSISTENCE_QUEUE_NAME, {
  connection: bullRedisConnection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

sessionPersistenceQueue.on('error', (err) => {
  logger.error(`[BullMQ:SessionPersistenceQueue] Queue error: ${err.message}`);
});

/**
 * Enqueue a background job to asynchronously persist session creation into MongoDB.
 */
export const enqueueSessionStarted = async (payload, jobOptions = {}) => {
  try {
    const job = await sessionPersistenceQueue.add(
      SESSION_JOBS.SESSION_STARTED,
      payload,
      {
        jobId: `start:${payload.sessionId}`,
        priority: 1,
        ...jobOptions,
      }
    );
    return job;
  } catch (err) {
    logger.error(`[BullMQ:SessionPersistenceQueue] Failed to enqueue session started: ${err.message}`);
    return null;
  }
};

/**
 * Enqueue a background job to asynchronously persist session termination and final settlement.
 */
export const enqueueSessionEnded = async (payload, jobOptions = {}) => {
  try {
    const job = await sessionPersistenceQueue.add(
      SESSION_JOBS.SESSION_ENDED,
      payload,
      {
        jobId: `end:${payload.sessionId}`,
        priority: 1,
        ...jobOptions,
      }
    );
    return job;
  } catch (err) {
    logger.error(`[BullMQ:SessionPersistenceQueue] Failed to enqueue session ended: ${err.message}`);
    return null;
  }
};

/**
 * Enqueue a background job to asynchronously switch session segment.
 */
export const enqueueSessionSegmentSwitched = async (payload, jobOptions = {}) => {
  try {
    const job = await sessionPersistenceQueue.add(
      SESSION_JOBS.SESSION_SEGMENT_SWITCHED,
      payload,
      {
        priority: 2,
        ...jobOptions,
      }
    );
    return job;
  } catch (err) {
    logger.error(`[BullMQ:SessionPersistenceQueue] Failed to enqueue segment switch: ${err.message}`);
    return null;
  }
};
