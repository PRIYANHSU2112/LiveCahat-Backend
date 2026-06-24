import notificationRepository from '../repositories/notification.repository.js';
import Notification from '../modules/notification.model.js';
import User from '../modules/user.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import logger from '../utils/logger.util.js';

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
    return { sent, audience };
  }
}

export default new NotificationService();
