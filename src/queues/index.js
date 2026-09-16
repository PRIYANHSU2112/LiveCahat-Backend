import { notificationQueue } from './notification.queue.js';
import { sessionPersistenceQueue } from './session-persistence.queue.js';
import { chatPersistenceQueue } from './chat-persistence.queue.js';
import { storyCleanupQueue, enqueueStoryCleanup, initializeStoryCleanupSchedule } from './story-cleanup.queue.js';
import logger from '../utils/logger.util.js';

export const allQueues = [
  notificationQueue,
  sessionPersistenceQueue,
  chatPersistenceQueue,
  storyCleanupQueue,
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

export {
  sessionPersistenceQueue,
  enqueueSessionStarted,
  enqueueSessionEnded,
  enqueueSessionSegmentSwitched,
} from './session-persistence.queue.js';

export {
  chatPersistenceQueue,
  enqueueChatPersistence,
} from './chat-persistence.queue.js';

export {
  storyCleanupQueue,
  enqueueStoryCleanup,
  initializeStoryCleanupSchedule,
} from './story-cleanup.queue.js';


