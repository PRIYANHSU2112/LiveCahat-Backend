import { Worker } from 'bullmq';
import { bullRedisConnection } from '../config/bullmq.js';
import { NOTIFICATION_QUEUE_NAME, NOTIFICATION_JOBS } from '../queues/notification.queue.js';
import notificationService from '../services/notification.service.js';
import logger from '../utils/logger.util.js';

/**
 * Process LIVE_STARTED Notification Job
 * Delegates to NotificationService which uses FollowRepository and NotificationRepository.
 */
const processLiveStartedJob = async (job) => {
  const { hostId, roomId, hostName, title, mode = 'VIDEO' } = job.data;
  logger.info(`[BullMQ:NotificationWorker] Processing LIVE_STARTED job ${job.id} for host ${hostId} (Room: ${roomId})`);

  const result = await notificationService.notifyFollowersLiveStarted(hostId, {
    roomId,
    hostName,
    title,
    mode,
  });

  return result;
};

/**
 * Notification Worker Processor
 */
export const createNotificationWorker = (options = {}) => {
  const worker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case NOTIFICATION_JOBS.LIVE_STARTED:
          return await processLiveStartedJob(job);
        default:
          logger.warn(`[BullMQ:NotificationWorker] Unknown job name: ${job.name}`);
          return { skipped: true };
      }
    },
    {
      connection: bullRedisConnection,
      concurrency: options.concurrency || 5, // Concurrent jobs
      lockDuration: 60000, // 60s lock for large broadcasts
      ...options,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`[BullMQ:NotificationWorker] Job ${job.id} (${job.name}) completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[BullMQ:NotificationWorker] Job ${job?.id} (${job?.name}) failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[BullMQ:NotificationWorker] Worker error: ${err.message}`);
  });

  return worker;
};

