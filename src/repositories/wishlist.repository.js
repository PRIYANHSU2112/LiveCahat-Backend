import Wishlist from '../modules/wishlist.model.js';
import BaseRepository from './base.repository.js';
import mongoose from 'mongoose';

class WishlistRepository extends BaseRepository {
  constructor() {
    super(Wishlist);
  }

  /**
   * Atomically add a listener to user's wishlist (upsert to prevent duplicate race conditions).
   */
  async add(userId, listenerId) {
    return await this.model.findOneAndUpdate(
      { userId },
      { $addToSet: { listeners: listenerId } },
      { upsert: true, new: true, lean: true }
    );
  }

  /**
   * Remove a listener from user's wishlist.
   * Query constraint { listeners: listenerId } ensures we only update if it was actually present.
   */
  async remove(userId, listenerId) {
    return await this.model.findOneAndUpdate(
      { userId, listeners: listenerId },
      { $pull: { listeners: listenerId } },
      { new: true, lean: true }
    );
  }

  /**
   * Check if a listener is in user's wishlist.
   */
  async isWishlisted(userId, listenerId) {
    return await this.model.findOne({ userId, listeners: listenerId }).select('_id').lean();
  }

  /**
   * Get paginated wishlist for a user, populated with user profile and listener details.
   */
  async getWishlist(userId, skip, limit) {
    const pipeline = [
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $unwind: '$listeners' },
      // Lookup the wishlisted user (listener)
      {
        $lookup: {
          from: 'users',
          localField: 'listeners',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            { $match: { isDeleted: false, isBlocked: false } },
            { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
          ],
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      // Lookup listener profile details for that listener
      {
        $lookup: {
          from: 'listenerprofiles',
          localField: 'listeners',
          foreignField: 'userId',
          as: 'listenerProfile',
          pipeline: [
            {
              $project: {
                bio: 1,
                categories: 1,
                avgRating: 1,
                totalRatings: 1,
                chatRate: 1,
                voiceRate: 1,
                videoRate: 1,
                availability: 1,
                profilePhotos: 1,
                interests: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: '$listenerProfile', preserveNullAndEmptyArrays: true } },
      // Shape output and paginate
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                listenerId: '$listeners',
                user: 1,
                listenerProfile: 1,
              },
            },
          ],
        },
      },
    ];

    const result = await this.model.aggregate(pipeline);
    if (!result || result.length === 0) {
      return { total: 0, data: [] };
    }
    const total = result[0].metadata[0]?.total || 0;
    const data = result[0].data || [];

    return { total, data };
  }
}

export default new WishlistRepository();
