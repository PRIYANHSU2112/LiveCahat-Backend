import { Worker } from 'bullmq';
import { bullRedisConnection } from '../config/bullmq.js';
import { CHAT_PERSISTENCE_QUEUE_NAME } from '../queues/chat-persistence.queue.js';
import ChatMessage from '../modules/chat-message.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import logger from '../utils/logger.util.js';

/**
 * Process a SAVE_MESSAGE job:
 * Idempotently saves a chat message to MongoDB using clientMsgId as unique key.
 * If coins were charged, also persists the coin transaction & reconciles MongoDB wallet.
 */
async function processSaveMessage(data) {
  const {
    clientMsgId,
    senderId,
    recipientId,
    text,
    messageType = 'TEXT',
    fileUrl = null,
    serverTimestamp,
    coinsCost = 0,
  } = data;

  try {
    // 1. Idempotent upsert of chat message using clientMsgId
    const messageDoc = await ChatMessage.findOneAndUpdate(
      { clientMsgId },
      {
        $setOnInsert: {
          clientMsgId,
          senderId,
          recipientId,
          text,
          messageType,
          fileUrl,
          createdAt: serverTimestamp ? new Date(serverTimestamp) : new Date(),
          deliveryStatus: 'SENT',
        },
      },
      { upsert: true, new: true }
    );

    // 2. If coins were deducted on the hot path, record transaction in MongoDB
    if (coinsCost > 0) {
      await Wallet.findOneAndUpdate(
        { userId: senderId },
        { $inc: { balance: -coinsCost, totalSpent: coinsCost } }
      ).catch((wErr) => {
        logger.error(`[BullMQ:ChatWorker] Failed to sync wallet for ${senderId}: ${wErr.message}`);
      });

      await CoinTransaction.create({
        userId: senderId,
        type: 'DEBIT',
        amount: coinsCost,
        reason: 'CHAT_MESSAGE',
        description: `Direct message to ${recipientId}`,
        referenceId: messageDoc._id,
      }).catch((tErr) => {
        logger.error(`[BullMQ:ChatWorker] Failed to record transaction: ${tErr.message}`);
      });
    }

    logger.info(`[BullMQ:ChatWorker] Persisted message ${clientMsgId} (doc=${messageDoc._id})`);
    return { success: true, messageId: messageDoc._id };
  } catch (err) {
    logger.error(`[BullMQ:ChatWorker] SaveMessage error for ${clientMsgId}: ${err.message}`);
    throw err; // triggers BullMQ retry with exponential backoff
  }
}

/**
 * Process a MARK_READ job:
 * Updates readAt & deliveryStatus = 'READ' for all unread messages from partner to reader.
 */
async function processMarkRead(data) {
  const { readerId, partnerId, lastReadMessageId } = data;

  try {
    const filter = {
      senderId: partnerId,
      recipientId: readerId,
      readAt: null,
    };

    if (lastReadMessageId) {
      filter._id = { $lte: lastReadMessageId };
    }

    const res = await ChatMessage.updateMany(filter, {
      $set: {
        readAt: new Date(),
        deliveryStatus: 'READ',
      },
    });

    logger.info(`[BullMQ:ChatWorker] Marked ${res.modifiedCount} messages as READ for ${readerId}`);
    return { success: true, modifiedCount: res.modifiedCount };
  } catch (err) {
    logger.error(`[BullMQ:ChatWorker] MarkRead error: ${err.message}`);
    throw err;
  }
}

/**
 * Factory to create and start the BullMQ Chat Persistence Worker.
 */
export const createChatPersistenceWorker = () => {
  const worker = new Worker(
    CHAT_PERSISTENCE_QUEUE_NAME,
    async (job) => {
      const { type } = job.data;
      if (type === 'MARK_READ') {
        return await processMarkRead(job.data);
      }
      return await processSaveMessage(job.data);
    },
    {
      connection: bullRedisConnection,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[BullMQ:ChatWorker] Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`[BullMQ:ChatWorker] Worker error: ${err.message}`);
  });

  return worker;
};
