import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { bullRedisConnection } from '../config/bullmq.js';
import { NOTIFICATION_QUEUE_NAME, NOTIFICATION_JOBS } from '../queues/notification.queue.js';
import Follow from '../modules/follow.model.js';
import Notification from '../modules/notification.model.js';
import fcmService from '../services/fcm.service.js';
import { emitToUser } from '../utils/socket.util.js';
import logger from '../utils/logger.util.js';

const FCM_BATCH_SIZE = 500;

/**
 * Process LIVE_STARTED Notification Job
 * Streams followers from MongoDB in 500-sized batches, creates in-app records,
 * and sends FCM multicast push notifications without spiking CPU or RAM.
 */
const processLiveStartedJob = async (job) => {
  const { hostId, roomId, hostName, title, mode = 'VIDEO' } = job.data;
  logger.info(`[BullMQ:NotificationWorker] Processing LIVE_STARTED job ${job.id} for host ${hostId} (Room: ${roomId})`);

  const notificationTitle = `${hostName || 'A host you follow'} is now LIVE! 🔴`;
  const notificationBody = title
    ? `"${title}" - Tap to join the live room now.`
    : `Tap to join the ${mode.toLowerCase()} live stream now.`;

  const metadata = {
    type: 'LIVE_STARTED',
    roomId: roomId?.toString?.() || roomId,
    hostId: hostId?.toString?.() || hostId,
    hostName: hostName || '',
    mode: mode || 'VIDEO',
  };

  const hostObjectId = new mongoose.Types.ObjectId(hostId);

  // Aggregation cursor to stream follower IDs and their FCM tokens efficiently
  const cursor = Follow.aggregate([
    { $match: { followingId: hostObjectId } },
    {
      $lookup: {
        from: 'users',
        localField: 'followerId',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $match: { isDeleted: false, isBlocked: false } },
          { $project: { _id: 1, fcmToken: 1, 'settings.notifications': 1 } },
        ],
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        followerId: '$user._id',
        fcmToken: '$user.fcmToken',
        notificationsEnabled: '$user.settings.notifications',
      },
    },
  ]).cursor({ batchSize: FCM_BATCH_SIZE });

  let currentBatchTokens = [];
  let currentInAppDocs = [];
  let totalProcessed = 0;

  const flushBatch = async (tokens, inAppDocs) => {
    // 1. Bulk insert in-app notification rows
    if (inAppDocs.length > 0) {
      try {
        await Notification.insertMany(inAppDocs, { ordered: false });
      } catch (insertErr) {
        logger.error(`[BullMQ:NotificationWorker] In-app bulk insert error: ${insertErr.message}`);
      }
    }

    // 2. Multicast FCM push
    if (tokens.length > 0) {
      try {
        await fcmService.sendMulticast(tokens, {
          title: notificationTitle,
          body: notificationBody,
          data: metadata,
        });
      } catch (fcmErr) {
        logger.error(`[BullMQ:NotificationWorker] FCM multicast error: ${fcmErr.message}`);
      }
    }
  };

  for await (const doc of cursor) {
    const recipientId = doc.followerId;
    const fcmToken = doc.fcmToken;
    const isEnabled = doc.notificationsEnabled !== false;

    // Real-time socket notification if active
    try {
      emitToUser(recipientId.toString(), 'notification:new', {
        title: notificationTitle,
        body: notificationBody,
        type: 'LIVE_STARTED',
        metadata,
        createdAt: new Date(),
      });
    } catch (_) {}

    // In-app notification
    currentInAppDocs.push({
      recipientId,
      senderId: hostId,
      title: notificationTitle,
      body: notificationBody,
      type: 'LIVE_STARTED',
      metadata,
    });

    // FCM token
    if (fcmToken && isEnabled) {
      currentBatchTokens.push(fcmToken);
    }

    totalProcessed++;

    // Progress update every 1000 items
    if (totalProcessed % 1000 === 0) {
      await job.updateProgress({ processed: totalProcessed });
    }

    // When batch hits FCM maximum (500), flush
    if (currentInAppDocs.length >= FCM_BATCH_SIZE) {
      const tokensToFlush = [...currentBatchTokens];
      const docsToFlush = [...currentInAppDocs];
      currentBatchTokens = [];
      currentInAppDocs = [];

      await flushBatch(tokensToFlush, docsToFlush);
    }
  }

  // Flush remaining items
  if (currentInAppDocs.length > 0 || currentBatchTokens.length > 0) {
    await flushBatch(currentBatchTokens, currentInAppDocs);
  }

  logger.info(`[BullMQ:NotificationWorker] Completed LIVE_STARTED job ${job.id}. Dispatched to ${totalProcessed} followers.`);
  return { totalFollowersNotified: totalProcessed };
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

  worker.on('completed', (job, result) => {
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
