import { createNotificationWorker } from './notification.worker.js';
import { createSessionPersistenceWorker } from './session-persistence.worker.js';
import { createChatPersistenceWorker } from './chat-persistence.worker.js';
import logger from '../utils/logger.util.js';

let activeWorkers = [];

/**
 * Initialize and start all background BullMQ workers
 */
export const initializeWorkers = () => {
  logger.info('[BullMQ] Initializing background workers...');

  const notificationWorker = createNotificationWorker();
  const sessionPersistenceWorker = createSessionPersistenceWorker();
  const chatPersistenceWorker = createChatPersistenceWorker();
  activeWorkers = [notificationWorker, sessionPersistenceWorker, chatPersistenceWorker];

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

export {
  createSessionPersistenceWorker,
} from './session-persistence.worker.js';

export {
  createChatPersistenceWorker,
} from './chat-persistence.worker.js';

