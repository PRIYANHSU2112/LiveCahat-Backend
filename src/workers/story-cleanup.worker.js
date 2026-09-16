import { Worker } from 'bullmq';
import { bullRedisConnection } from '../config/bullmq.js';
import { STORY_CLEANUP_QUEUE_NAME } from '../queues/story-cleanup.queue.js';
import storyService from '../services/story.service.js';
import logger from '../utils/logger.util.js';

/**
 * Story Cleanup Background Worker
 * Periodically expires stories older than 24 hours and updates the active_owners ZSET.
 */
export const createStoryCleanupWorker = () => {
  const worker = new Worker(
    STORY_CLEANUP_QUEUE_NAME,
    async (job) => {
      logger.info(`[BullMQ:StoryWorker] Running story expiry cleanup (job: ${job.id})...`);
      const expiredCount = await storyService.cleanupExpiredStories();
      logger.info(`[BullMQ:StoryWorker] Story expiry cleanup finished. Expired count: ${expiredCount}`);
      return { success: true, expiredCount };
    },
    {
      connection: bullRedisConnection,
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[BullMQ:StoryWorker] Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[BullMQ:StoryWorker] Worker error: ${err.message}`);
  });

  return worker;
};
