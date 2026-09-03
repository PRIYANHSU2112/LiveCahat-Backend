import { Worker } from 'bullmq';
import { bullRedisConnection } from '../config/bullmq.js';
import { SESSION_PERSISTENCE_QUEUE_NAME, SESSION_JOBS } from '../queues/session-persistence.queue.js';
import CommunicationSession from '../modules/communication-session.model.js';
import SessionSegment from '../modules/session-segment.model.js';
import logger from '../utils/logger.util.js';

/**
 * Process Session Started Job (Idempotent MongoDB write)
 */
const processSessionStartedJob = async (job) => {
  const { sessionId, callerId, listenerId, mode, ratePerMinute, startTime } = job.data;
  const startAt = startTime ? new Date(startTime) : new Date();

  // 1. Idempotently upsert CommunicationSession document
  await CommunicationSession.findOneAndUpdate(
    { _id: sessionId },
    {
      $setOnInsert: {
        _id: sessionId,
        callerId,
        listenerId,
        startTime: startAt,
        status: 'ONGOING',
        totalCoinsSpent: 0,
        totalCoinsEarned: 0,
      },
    },
    { upsert: true, new: true }
  );

  // 2. Idempotently create first SessionSegment
  const existingSegment = await SessionSegment.findOne({ sessionId, status: 'ONGOING' });
  if (!existingSegment) {
    await SessionSegment.create({
      sessionId,
      mode,
      startTime: startAt,
      ratePerMinute: Number(ratePerMinute) || 0,
      status: 'ONGOING',
    });
  }

  logger.info(`[BullMQ:SessionWorker] Idempotently persisted Session ${sessionId} in MongoDB.`);
  return { sessionId, status: 'CREATED' };
};

/**
 * Process Session Ended Job (Idempotent MongoDB finalization)
 */
const processSessionEndedJob = async (job) => {
  const { sessionId, endTime, disconnectReason, duration, totalCoinsSpent, totalCoinsEarned } = job.data;
  const endAt = endTime ? new Date(endTime) : new Date();

  // 1. Mark ongoing segments as COMPLETED
  await SessionSegment.updateMany(
    { sessionId, status: 'ONGOING' },
    { $set: { status: 'COMPLETED', endTime: endAt } }
  );

  // 2. Finalize CommunicationSession summary
  const updateFields = {
    status: 'COMPLETED',
    endTime: endAt,
    disconnectReason: disconnectReason || 'NORMAL_DISCONNECT',
  };

  if (duration !== undefined) updateFields.duration = duration;
  if (totalCoinsSpent !== undefined) updateFields.totalCoinsSpent = totalCoinsSpent;
  if (totalCoinsEarned !== undefined) updateFields.totalCoinsEarned = totalCoinsEarned;

  await CommunicationSession.findByIdAndUpdate(sessionId, { $set: updateFields });

  logger.info(`[BullMQ:SessionWorker] Idempotently finalized Session ${sessionId} in MongoDB.`);
  return { sessionId, status: 'COMPLETED' };
};

/**
 * Process Segment Switch Job
 */
const processSegmentSwitchJob = async (job) => {
  const { sessionId, newMode, newRatePerMinute, switchedAt } = job.data;
  const switchTime = switchedAt ? new Date(switchedAt) : new Date();

  await SessionSegment.updateMany(
    { sessionId, status: 'ONGOING' },
    { $set: { status: 'COMPLETED', endTime: switchTime } }
  );

  await SessionSegment.create({
    sessionId,
    mode: newMode,
    startTime: switchTime,
    ratePerMinute: Number(newRatePerMinute) || 0,
    status: 'ONGOING',
  });

  logger.info(`[BullMQ:SessionWorker] Switched segment for Session ${sessionId} to ${newMode} at ${newRatePerMinute}/min.`);
  return { sessionId, mode: newMode };
};

/**
 * Create BullMQ Session Persistence Worker
 */
export const createSessionPersistenceWorker = (options = {}) => {
  const worker = new Worker(
    SESSION_PERSISTENCE_QUEUE_NAME,
    async (job) => {
      switch (job.name) {
        case SESSION_JOBS.SESSION_STARTED:
          return await processSessionStartedJob(job);
        case SESSION_JOBS.SESSION_ENDED:
          return await processSessionEndedJob(job);
        case SESSION_JOBS.SESSION_SEGMENT_SWITCHED:
          return await processSegmentSwitchJob(job);
        default:
          logger.warn(`[BullMQ:SessionWorker] Unknown job name: ${job.name}`);
          return { skipped: true };
      }
    },
    {
      connection: bullRedisConnection,
      concurrency: options.concurrency || 10,
      ...options,
    }
  );

  worker.on('completed', (job) => {
    logger.debug(`[BullMQ:SessionWorker] Job ${job.id} completed.`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[BullMQ:SessionWorker] Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[BullMQ:SessionWorker] Worker error: ${err.message}`);
  });

  return worker;
};
