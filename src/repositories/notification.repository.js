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
}

export default new NotificationRepository();
