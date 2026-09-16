import { Queue } from 'bullmq';
import { bullRedisConnection, defaultJobOptions } from '../config/bullmq.js';
import logger from '../utils/logger.util.js';

export const STORY_CLEANUP_QUEUE_NAME = 'story_cleanup';

export const STORY_CLEANUP_JOBS = {
  CLEANUP_EXPIRED: 'story:cleanup_expired',
};

/**
 * BullMQ Story Cleanup Queue Instance
 */
export const storyCleanupQueue = new Queue(STORY_CLEANUP_QUEUE_NAME, {
  connection: bullRedisConnection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

storyCleanupQueue.on('error', (err) => {
  logger.error(`[BullMQ:StoryCleanupQueue] Queue error: ${err.message}`);
});

/**
 * Enqueue an immediate story cleanup job
 */
export const enqueueStoryCleanup = async (payload = {}, jobOptions = {}) => {
  try {
    const job = await storyCleanupQueue.add(
      STORY_CLEANUP_JOBS.CLEANUP_EXPIRED,
      payload,
      {
        jobId: `story_cleanup_${Date.now()}`,
        ...jobOptions,
      }
    );
    return job;
  } catch (err) {
    logger.error(`[BullMQ:StoryCleanupQueue] Failed to enqueue cleanup job: ${err.message}`);
    return null;
  }
};

/**
 * Setup repeating 10-minute story cleanup job
 */
export const initializeStoryCleanupSchedule = async () => {
  try {
    await storyCleanupQueue.add(
      STORY_CLEANUP_JOBS.CLEANUP_EXPIRED,
      {},
      {
        jobId: 'story_repeating_cleanup_job',
        repeat: {
          every: 10 * 60 * 1000, // Every 10 minutes
        },
      }
    );
    logger.info('[BullMQ:StoryCleanup] Recurring 10-minute story cleanup scheduled.');
  } catch (err) {
    logger.error(`[BullMQ:StoryCleanup] Failed to schedule repeating cleanup: ${err.message}`);
  }
};
