import mongoose from 'mongoose';
import notificationRepository from '../repositories/notification.repository.js';
import userRepository from '../repositories/user.repository.js';
import followRepository from '../repositories/follow.repository.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getPeriodRange } from '../utils/date.util.js';
import { buildUtcCreatedAtFilter } from '../utils/date-filter.util.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import { emitToUser } from '../utils/socket.util.js';
import fcmService from './fcm.service.js';
import logger from '../utils/logger.util.js';

const ADMIN_STATS_CACHE_KEY = 'notifications:admin:stats';

// Audience → user `type` mapping for admin broadcasts.
const AUDIENCE_TYPE = {
  CUSTOMER: 'CUSTOMER',
  LISTENER: 'LISTENER',
  AGENT: 'AGENT',
};

// Insert broadcasts in chunks so a single huge insert can't stall the event loop.
const BROADCAST_CHUNK = 1000;

class NotificationService {
  // ─── Recipient-facing (own notifications only) ───────────────────

  /**
   * List the current user's notifications. Each account — customer, listener,
   * agent or admin — only ever sees rows where `recipientId` is itself.
   * Supports filtering by status / type plus pagination.
   */
  async getMyNotifications(userId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });

    const filter = { recipientId: userId };
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;

    const [docs, total] = await Promise.all([
      notificationRepository.findMany(filter, '', '', sort, limit, skip),
      notificationRepository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  async getUnreadCount(userId) {
    const unreadCount = await notificationRepository.countDocuments({
      recipientId: userId,
      status: 'UNREAD',
    });
    return { unreadCount };
  }

  /**
   * KPI strip for the current user's inbox: unread, today, this week, muted.
   */
  async getMyStats(userId) {
    const { start: todayStart } = getPeriodRange('today');
    const { start: weekStart } = getPeriodRange('week');
    return notificationRepository.getStatsCounts({ recipientId: userId }, todayStart, weekStart);
  }

  /**
   * Platform-wide KPI strip for admin dashboards.
   */
  async getAdminStats() {
    const cached = await getCache(ADMIN_STATS_CACHE_KEY);
    if (cached) return cached;

    const { start: todayStart } = getPeriodRange('today');
    const { start: weekStart } = getPeriodRange('week');
    const stats = await notificationRepository.getStatsCounts({}, todayStart, weekStart);
    await setCache(ADMIN_STATS_CACHE_KEY, stats, 30);
    return stats;
  }

  async bustAdminStatsCache() {
    await deleteCache(ADMIN_STATS_CACHE_KEY);
  }

  /**
   * Paginated platform notification log for admin.
   */
  async adminListNotifications(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });

    const match = { ...buildUtcCreatedAtFilter(query) };
    if (query.status) match.status = query.status;
    if (query.type) match.type = query.type;

    if (query.search?.trim()) {
      const regex = { $regex: query.search.trim(), $options: 'i' };
      match.$or = [{ title: regex }, { body: regex }];
    }

    const pipeline = [
      { $match: match },
      { $sort: sort },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: 'recipientId',
                foreignField: '_id',
                as: 'recipient',
              },
            },
            { $unwind: { path: '$recipient', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                title: 1,
                body: 1,
                type: 1,
                status: 1,
                pushSent: 1,
                pushError: 1,
                createdAt: 1,
                recipient: {
                  id: '$recipient._id',
                  firstName: '$recipient.firstName',
                  lastName: '$recipient.lastName',
                  email: '$recipient.email',
                  type: '$recipient.type',
                },
              },
            },
          ],
        },
      },
    ];

    const [result] = await notificationRepository.aggregateLogs(pipeline);
    const total = result.metadata[0]?.total ?? 0;
    const docs = (result.data ?? []).map((row) => ({
      id: row._id.toString(),
      title: row.title,
      body: row.body,
      type: row.type,
      status: row.status,
      pushSent: row.pushSent,
      pushError: row.pushError,
      recipient: row.recipient?.id
        ? {
            id: row.recipient.id.toString(),
            firstName: row.recipient.firstName,
            lastName: row.recipient.lastName,
            email: row.recipient.email,
            type: row.recipient.type,
          }
        : null,
      createdAt: row.createdAt,
    }));

    return formatPaginatedResponse(docs, total, page, limit);
  }

  async markAsRead(userId, notificationId) {
    // Recipient guard in the filter prevents reading someone else's notification.
    const notification = await notificationRepository.updateOne(
      { _id: notificationId, recipientId: userId },
      { $set: { status: 'READ' } }
    );
    if (!notification) throw new ApiError(404, 'Notification not found');
    return notification;
  }

  async markAllAsRead(userId) {
    const result = await notificationRepository.markAllAsRead(userId);
    return { modified: result.modifiedCount ?? 0 };
  }

  async deleteNotification(userId, notificationId) {
    const notification = await notificationRepository.deleteOneByRecipient(
      notificationId,
      userId
    );
    if (!notification) throw new ApiError(404, 'Notification not found');
    return { deleted: true };
  }

  // ─── Admin: send ─────────────────────────────────────────────────

  /**
   * Admin sends a notification to one specific recipient (user / listener / agent).
   */
  async sendToUser(senderId, { recipientId, title, body, type = 'SYSTEM', metadata = {} }) {
    const recipient = await userRepository.findById(
      recipientId,
      '_id isDeleted fcmToken settings'
    );
    if (!recipient || recipient.isDeleted) {
      throw new ApiError(404, 'Recipient not found');
    }

    const notification = await notificationRepository.create({
      recipientId,
      senderId,
      title,
      body,
      type,
      metadata,
    });

    // Real-time socket delivery
    try {
      emitToUser(recipientId.toString(), 'notification:new', {
        id: notification._id,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        metadata: notification.metadata,
        createdAt: notification.createdAt,
      });
    } catch (err) {
      logger.warn(`[NotificationService] Socket emit failed for user ${recipientId}: ${err.message}`);
    }

    // Firebase Cloud Messaging Push delivery (fire-and-forget / recorded)
    const canSendPush = recipient.settings?.notifications !== false && Boolean(recipient.fcmToken);
    if (canSendPush) {
      try {
        const pushResult = await fcmService.sendToToken(recipient.fcmToken, {
          title,
          body,
          data: {
            ...metadata,
            notificationId: notification._id.toString(),
            type,
          },
        });

        if (pushResult.success) {
          notification.pushSent = true;
          await notificationRepository.updateById(notification._id, { pushSent: true });
        } else if (pushResult.error) {
          notification.pushError = pushResult.error;
          await notificationRepository.updateById(notification._id, {
            pushSent: false,
            pushError: pushResult.error,
          });
        }
      } catch (fcmErr) {
        logger.error(`[NotificationService] FCM push error for user ${recipientId}: ${fcmErr.message}`);
      }
    }

    await this.bustAdminStatsCache();
    return notification;
  }

  /**
   * Admin broadcast to an audience:
   *   CUSTOMER → all users · LISTENER → all listeners · AGENT → all agents · ALL → everyone
   */
  async broadcast(senderId, { audience, title, body, type = 'SYSTEM', metadata = {} }) {
    const filter = { isDeleted: false };
    if (audience !== 'ALL') {
      const userType = AUDIENCE_TYPE[audience];
      if (!userType) throw new ApiError(400, 'Invalid audience');
      filter.type = userType;
    } else {
      // "Everyone" still excludes admins — they manage, they aren't the audience.
      filter.type = { $in: ['CUSTOMER', 'LISTENER', 'AGENT'] };
    }

    const recipients = await userRepository.findMany(
      filter,
      '_id fcmToken settings'
    );
    if (recipients.length === 0) {
      return { sent: 0, audience };
    }

    const base = { senderId, title, body, type, metadata };
    let sent = 0;
    const tokens = [];

    for (let i = 0; i < recipients.length; i += BROADCAST_CHUNK) {
      const batch = recipients.slice(i, i + BROADCAST_CHUNK);
      const chunk = batch.map((u) => {
        if (u.fcmToken && u.settings?.notifications !== false) {
          tokens.push(u.fcmToken);
        }
        // Real-time socket broadcast
        try {
          emitToUser(u._id.toString(), 'notification:new', {
            title,
            body,
            type,
            metadata,
            createdAt: new Date(),
          });
        } catch (_) {}

        return {
          ...base,
          recipientId: u._id,
        };
      });

      // ordered:false → one bad row won't abort the whole batch.
      const inserted = await notificationRepository.bulkInsert(chunk);
      sent += inserted.length;
    }

    // Multicast push notifications if tokens are available
    if (tokens.length > 0) {
      fcmService.sendMulticast(tokens, {
        title,
        body,
        data: {
          ...metadata,
          type,
        },
      }).catch((err) => {
        logger.error(`[NotificationService] FCM broadcast error: ${err.message}`);
      });
    }

    logger.info(`[NotificationService] Broadcast "${title}" sent to ${sent} ${audience} recipient(s)`);
    await this.bustAdminStatsCache();
    return { sent, audience };
  }

  // ─── Live Stream Follower Alerts (Background Service Method) ──

  /**
   * High-performance follower alert processor.
   * Uses FollowRepository streaming cursor and NotificationRepository bulk insert.
   *
   * @param {string} hostId - Listener / Host User ID
   * @param {object} liveData - { roomId, hostName, title, mode }
   */
  async notifyFollowersLiveStarted(hostId, { roomId, hostName, title, mode = 'VIDEO' }) {
    const FCM_BATCH_SIZE = 500;
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

    // Stream followers with their FCM token and settings using FollowRepository cursor
    const cursor = followRepository.getFollowersNotificationCursor(hostId, FCM_BATCH_SIZE);

    let currentBatchTokens = [];
    let currentInAppDocs = [];
    let totalNotified = 0;

    const processBatch = async (tokens, inAppDocs) => {
      // 1. Bulk insert in-app notifications via repository
      if (inAppDocs.length > 0) {
        notificationRepository.bulkInsert(inAppDocs).catch((err) => {
          logger.error(`[LiveNotification] Bulk insert in-app notification error: ${err.message}`);
        });
      }

      // 2. Multicast FCM Push
      if (tokens.length > 0) {
        fcmService
          .sendMulticast(tokens, {
            title: notificationTitle,
            body: notificationBody,
            data: metadata,
          })
          .catch((err) => {
            logger.error(`[LiveNotification] FCM multicast error for batch: ${err.message}`);
          });
      }
    };

    for await (const doc of cursor) {
      const recipientId = doc.followerId;
      const fcmToken = doc.fcmToken;
      const isEnabled = doc.notificationsEnabled !== false;

      // Real-time socket notification to online users
      try {
        emitToUser(recipientId.toString(), 'notification:new', {
          title: notificationTitle,
          body: notificationBody,
          type: 'LIVE_STARTED',
          metadata,
          createdAt: new Date(),
        });
      } catch (_) {}

      // In-app notification record
      currentInAppDocs.push({
        recipientId,
        senderId: hostId,
        title: notificationTitle,
        body: notificationBody,
        type: 'LIVE_STARTED',
        metadata,
      });

      // FCM token collection
      if (fcmToken && isEnabled) {
        currentBatchTokens.push(fcmToken);
      }

      totalNotified++;

      // When batch reaches FCM_BATCH_SIZE (500), dispatch chunk
      if (currentInAppDocs.length >= FCM_BATCH_SIZE) {
        const tokensToFlush = [...currentBatchTokens];
        const docsToFlush = [...currentInAppDocs];
        currentBatchTokens = [];
        currentInAppDocs = [];

        await processBatch(tokensToFlush, docsToFlush);
      }
    }

    // Flush remaining
    if (currentInAppDocs.length > 0 || currentBatchTokens.length > 0) {
      await processBatch(currentBatchTokens, currentInAppDocs);
    }

    logger.info(`[LiveNotification] Dispatched live notifications to ${totalNotified} follower(s) for host ${hostId} (Room: ${roomId})`);
  }
}

export default new NotificationService();
