import mongoose from 'mongoose';
import BaseRepository from './base.repository.js';
import Notification from '../modules/notification.model.js';

class NotificationRepository extends BaseRepository {
  constructor() {
    super(Notification);
  }

  /**
   * Single aggregation pass for unread / today / this-week / muted counts.
   * @param {object} match - Mongo match filter (e.g. { recipientId } or {})
   * @param {Date} todayStart
   * @param {Date} weekStart
   */
  async getStatsCounts(match, todayStart, weekStart) {
    const filter = { ...match };
    if (filter.recipientId) {
      filter.recipientId = new mongoose.Types.ObjectId(filter.recipientId);
    }

    const [result] = await this.aggregate([
      { $match: filter },
      {
        $facet: {
          unread: [{ $match: { status: 'UNREAD' } }, { $count: 'count' }],
          today: [{ $match: { createdAt: { $gte: todayStart } } }, { $count: 'count' }],
          thisWeek: [{ $match: { createdAt: { $gte: weekStart } } }, { $count: 'count' }],
          muted: [{ $match: { isMuted: true } }, { $count: 'count' }],
        },
      },
    ]);

    const pick = (key) => result?.[key]?.[0]?.count ?? 0;
    return {
      unread: pick('unread'),
      today: pick('today'),
      thisWeek: pick('thisWeek'),
      muted: pick('muted'),
    };
  }

  /**
   * Bulk insert notifications (ordered: false prevents single failure from blocking batch)
   * @param {Array<Object>} docs
   */
  async bulkInsert(docs) {
    return this.model.insertMany(docs, { ordered: false });
  }

  /**
   * Mark all unread notifications as read for a recipient.
   * @param {string|mongoose.Types.ObjectId} recipientId
   */
  async markAllAsRead(recipientId) {
    return this.model.updateMany(
      { recipientId, status: 'UNREAD' },
      { $set: { status: 'READ', readAt: new Date() } }
    );
  }

  /**
   * Delete single notification scoped strictly to its owner.
   * @param {string|mongoose.Types.ObjectId} id
   * @param {string|mongoose.Types.ObjectId} recipientId
   */
  async deleteOneByRecipient(id, recipientId) {
    return this.model.findOneAndDelete({ _id: id, recipientId });
  }

  /**
   * Run custom aggregation pipelines on notification collection.
   * @param {Array<Object>} pipeline
   */
  async aggregateLogs(pipeline) {
    return this.model.aggregate(pipeline);
  }
}

export default new NotificationRepository();
