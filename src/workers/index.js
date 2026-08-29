import { createNotificationWorker } from './notification.worker.js';
import logger from '../utils/logger.util.js';

let activeWorkers = [];

/**
 * Initialize and start all background BullMQ workers
 */
export const initializeWorkers = () => {
  logger.info('[BullMQ] Initializing background workers...');

  const notificationWorker = createNotificationWorker();
  activeWorkers = [notificationWorker];

  logger.info(`[BullMQ] ${activeWorkers.length} background worker(s) running.`);
  return activeWorkers;
};

/**
 * Gracefully close all background workers
 */
export const closeAllWorkers = async () => {
  logger.info('[BullMQ] Gracefully closing workers...');
  await Promise.allSettled(activeWorkers.map((w) => w.close()));
  activeWorkers = [];
  logger.info('[BullMQ] All workers closed.');
};

export {
  createNotificationWorker,
} from './notification.worker.js';
