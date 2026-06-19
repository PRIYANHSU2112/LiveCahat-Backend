import mongoose from 'mongoose';
import BaseService from './base.service.js';
import reviewRepository from '../repositories/review.repository.js';
import User from '../modules/user.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

const REVIEWER_POPULATE = { path: 'userId', select: 'firstName lastName profileImage' };

class ReviewService extends BaseService {
  constructor() {
    super(reviewRepository);
  }

  /**
   * Create or update a customer's review for a listener.
   * Requires at least one COMPLETED session between the two users.
   */
  async createOrUpdateReview(userId, listenerId, { rating, reviewComment }) {
    if (userId.toString() === listenerId.toString()) {
      throw new ApiError(400, 'You cannot review yourself.');
    }

    // 1. Listener must exist and actually be a listener
    const listener = await User.findOne({ _id: listenerId, type: 'LISTENER', isDeleted: false }).select('_id').lean();
    if (!listener) throw new ApiError(404, 'Listener not found');

    // 2. Eligibility — at least one COMPLETED session with this listener
    const hasCompletedSession = await CommunicationSession.exists({
      callerId: userId,
      listenerId,
      status: 'COMPLETED',
    });
    if (!hasCompletedSession) {
      throw new ApiError(400, 'You can only review a listener after completing a session with them.');
    }

    // 3. Upsert the review
    const review = await this.repository.updateOne(
      { userId, listenerId },
      { $set: { rating, reviewComment } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    // 4. Sync listener profile ratings
    await this._recalculateListenerRatings(listenerId);

    return review;
  }

  /**
   * Delete a review owned by the user, then re-sync listener ratings.
   */
  async deleteReview(userId, reviewId) {
    const review = await this.repository.findById(reviewId);
    if (!review) throw new ApiError(404, 'Review not found');

    if (review.userId.toString() !== userId.toString()) {
      throw new ApiError(403, 'You can only delete your own review.');
    }

    await this.repository.deleteById(reviewId);
    await this._recalculateListenerRatings(review.listenerId);

    return { deleted: true };
  }

  /**
   * Paginated list of a listener's reviews, with reviewer details.
   */
  async getListenerReviews(listenerId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...query,
    });

    const filter = { listenerId };
    const [docs, total] = await Promise.all([
      this.repository.findMany(filter, '', REVIEWER_POPULATE, sort, limit, skip),
      this.repository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  /**
   * Recalculate avgRating + totalRatings for a listener from the Review
   * collection and persist them onto the ListenerProfile.
   */
  async _recalculateListenerRatings(listenerId) {
    const stats = await this.repository.aggregate([
      { $match: { listenerId: new mongoose.Types.ObjectId(listenerId) } },
      {
        $group: {
          _id: '$listenerId',
          avgRating: { $avg: '$rating' },
          totalRatings: { $sum: 1 },
        },
      },
    ]);

    const { avgRating = 0, totalRatings = 0 } = stats[0] || {};

    await ListenerProfile.updateOne(
      { userId: listenerId },
      {
        $set: {
          avgRating: Math.round(avgRating * 10) / 10, // 1 decimal place
          totalRatings,
        },
      }
    );

    return { avgRating: Math.round(avgRating * 10) / 10, totalRatings };
  }
}

export default new ReviewService();
