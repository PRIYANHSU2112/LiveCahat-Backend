import { Queue } from 'bullmq';
import { bullRedisConnection, defaultJobOptions } from '../config/bullmq.js';
import logger from '../utils/logger.util.js';

export const CHAT_PERSISTENCE_QUEUE_NAME = 'chat_persistence';

export const CHAT_JOBS = {
  SAVE_MESSAGE: 'chat:save_message',
  MARK_READ: 'chat:mark_read',
};

/**
 * BullMQ Chat Persistence Queue Instance
 */
export const chatPersistenceQueue = new Queue(CHAT_PERSISTENCE_QUEUE_NAME, {
  connection: bullRedisConnection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
});

chatPersistenceQueue.on('error', (err) => {
  logger.error(`[BullMQ:ChatPersistenceQueue] Queue error: ${err.message}`);
});

/**
 * Enqueue a background job to asynchronously persist chat messages or mark read in MongoDB.
 *
 * @param {Object} payload
 * @param {string} payload.type - 'SAVE_MESSAGE' | 'MARK_READ'
 */
export const enqueueChatPersistence = async (payload, jobOptions = {}) => {
  try {
    const jobId = payload.clientMsgId
      ? `msg_${payload.clientMsgId}`.replace(/[:]/g, '_')
      : `${payload.type || 'job'}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`.replace(/[:]/g, '_');

    const job = await chatPersistenceQueue.add(
      payload.type || CHAT_JOBS.SAVE_MESSAGE,
      payload,
      {
        jobId,
        priority: payload.type === 'SAVE_MESSAGE' ? 1 : 2,
        ...jobOptions,
      }
    );
    return job;
  } catch (err) {
    logger.error(`[BullMQ:ChatPersistenceQueue] Failed to enqueue chat persistence: ${err.message}`);
    return null;
  }
};
