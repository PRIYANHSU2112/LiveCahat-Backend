import { Queue } from 'bullmq';
import { bullRedisConnection, defaultJobOptions } from '../config/bullmq.js';
import logger from '../utils/logger.util.js';

export const NOTIFICATION_QUEUE_NAME = 'notifications';

export const NOTIFICATION_JOBS = {
  LIVE_STARTED: 'notification:live:started',
  BROADCAST: 'notification:broadcast',
  DIRECT: 'notification:direct',
};

/**
 * BullMQ Notification Queue Instance
 */
export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
  connection: bullRedisConnection,
  defaultJobOptions,
});

notificationQueue.on('error', (err) => {
  logger.error(`[BullMQ:NotificationQueue] Queue error: ${err.message}`);
});

/**
 * Enqueue a background job to notify followers when a listener starts live streaming.
 * 
 * @param {Object} payload - { hostId, roomId, hostName, title, mode }
 * @param {Object} [jobOptions] - custom overrides
 */
export const enqueueLiveStartedNotification = async (payload, jobOptions = {}) => {
  try {
    const job = await notificationQueue.add(
      NOTIFICATION_JOBS.LIVE_STARTED,
      payload,
      {
        priority: 1, // High priority for live stream alerts
        ...jobOptions,
      }
    );
    logger.info(`[BullMQ:NotificationQueue] Enqueued live started notification job (ID: ${job.id}, Host: ${payload.hostId})`);
    return job;
  } catch (err) {
    logger.error(`[BullMQ:NotificationQueue] Failed to enqueue live notification: ${err.message}`);
    return null;
  }
};

/**
 * Enqueue an admin broadcast notification job.
 * 
 * @param {Object} payload - { senderId, audience, title, body, type, metadata }
 */
export const enqueueBroadcastNotification = async (payload, jobOptions = {}) => {
  try {
    const job = await notificationQueue.add(
      NOTIFICATION_JOBS.BROADCAST,
      payload,
      {
        priority: 5,
        ...jobOptions,
      }
    );
    logger.info(`[BullMQ:NotificationQueue] Enqueued broadcast notification job (ID: ${job.id})`);
    return job;
  } catch (err) {
    logger.error(`[BullMQ:NotificationQueue] Failed to enqueue broadcast notification: ${err.message}`);
    return null;
  }
};
