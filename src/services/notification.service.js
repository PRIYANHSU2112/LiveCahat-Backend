import notificationRepository from '../repositories/notification.repository.js';
import Notification from '../modules/notification.model.js';
import User from '../modules/user.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getPeriodRange } from '../utils/date.util.js';
import { buildUtcCreatedAtFilter } from '../utils/date-filter.util.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
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

    const [result] = await Notification.aggregate(pipeline);
    const total = result.metadata[0]?.total ?? 0;
    const docs = (result.data ?? []).map((row) => ({
      id: row._id.toString(),
      title: row.title,
      body: row.body,
      type: row.type,
      status: row.status,
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
    const result = await Notification.updateMany(
      { recipientId: userId, status: 'UNREAD' },
      { $set: { status: 'READ' } }
    );
    return { modified: result.modifiedCount ?? 0 };
  }

  async deleteNotification(userId, notificationId) {
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipientId: userId,
    });
    if (!notification) throw new ApiError(404, 'Notification not found');
    return { deleted: true };
  }

  // ─── Admin: send ─────────────────────────────────────────────────

  /**
   * Admin sends a notification to one specific recipient (user / listener / agent).
   */
  async sendToUser(senderId, { recipientId, title, body, type = 'SYSTEM', metadata = {} }) {
    const recipient = await User.findById(recipientId).select('_id isDeleted').lean();
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

    const recipients = await User.find(filter).select('_id').lean();
    if (recipients.length === 0) {
      return { sent: 0, audience };
    }

    const base = { senderId, title, body, type, metadata };
    let sent = 0;

    for (let i = 0; i < recipients.length; i += BROADCAST_CHUNK) {
      const chunk = recipients.slice(i, i + BROADCAST_CHUNK).map((u) => ({
        ...base,
        recipientId: u._id,
      }));
      // ordered:false → one bad row won't abort the whole batch.
      const inserted = await Notification.insertMany(chunk, { ordered: false });
      sent += inserted.length;
    }

    logger.info(`Broadcast "${title}" sent to ${sent} ${audience} recipient(s)`);
    await this.bustAdminStatsCache();
    return { sent, audience };
  }
}

export default new NotificationService();
