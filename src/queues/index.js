import { notificationQueue } from './notification.queue.js';
import logger from '../utils/logger.util.js';

export const allQueues = [
  notificationQueue,
];

/**
 * Gracefully close all BullMQ queues
 */
export const closeAllQueues = async () => {
  logger.info('[BullMQ] Closing all queues...');
  await Promise.allSettled(allQueues.map((q) => q.close()));
  logger.info('[BullMQ] All queues closed.');
};

export {
  notificationQueue,
  enqueueLiveStartedNotification,
  enqueueBroadcastNotification,
} from './notification.queue.js';
