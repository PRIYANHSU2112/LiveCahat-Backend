import Follow from '../modules/follow.model.js';
import BaseRepository from './base.repository.js';
import mongoose from 'mongoose';

/**
 * Follow Repository — High-performance, race-condition-safe data layer.
 *
 * Key patterns:
 *   - Atomic upsert for follow (idempotent, no duplicates under concurrency)
 *   - Aggregation pipelines with $facet for single-pass pagination
 *   - Minimal projections to reduce I/O
 */
class FollowRepository extends BaseRepository {
  constructor() {
    super(Follow);
  }

  /**
   * Atomically follow a user (idempotent — no duplicate, no race condition).
   * Uses findOneAndUpdate + upsert so concurrent requests only create one document.
   * @returns {{ doc, isNewFollow: boolean }}
   */
  async follow(followerId, followingId) {
    const result = await this.model.findOneAndUpdate(
      { followerId, followingId },
      { $setOnInsert: { followerId, followingId, isFavorite: false } },
      { upsert: true, new: true, rawResult: true, lean: true }
    );

    return {
      doc: result.value,
      isNewFollow: result.lastErrorObject?.upserted != null,
    };
  }

  /**
   * Atomically unfollow a user.
   * @returns {Object|null} — the deleted doc, or null if not following
   */
  async unfollow(followerId, followingId) {
    return await this.model.findOneAndDelete({ followerId, followingId }).lean();
  }

  /**
   * Check if a user is following another.
   * Minimal projection (_id + isFavorite only) for speed.
   */
  async isFollowing(followerId, followingId) {
    return await this.model
      .findOne({ followerId, followingId })
      .select('_id isFavorite')
      .lean();
  }

  /**
   * Toggle the isFavorite flag on an existing follow relationship.
   */
  async toggleFavorite(followerId, followingId, isFavorite) {
    return await this.model.findOneAndUpdate(
      { followerId, followingId },
      { $set: { isFavorite } },
      { new: true, lean: true }
    );
  }

  /**
   * Get paginated list of users that a user is following (with listener profile data).
   * Uses aggregation with $facet for single-pass count + data.
   */
  async getFollowing(followerId, skip, limit) {
    const pipeline = [
      { $match: { followerId: new mongoose.Types.ObjectId(followerId) } },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            // Lookup the followed user
            {
              $lookup: {
                from: 'users',
                localField: 'followingId',
                foreignField: '_id',
                as: 'user',
                pipeline: [
                  { $match: { isDeleted: false, isBlocked: false } },
                  { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
                ],
              },
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
            // Lookup listener profile for the followed user
            {
              $lookup: {
                from: 'listenerprofiles',
                localField: 'followingId',
                foreignField: 'userId',
                as: 'listenerProfile',
                pipeline: [
                  {
                    $project: {
                      bio: 1, categories: 1, avgRating: 1, totalRatings: 1,
                      chatRate: 1, voiceRate: 1, videoRate: 1, availability: 1,
                      followersCount: 1, profilePhotos: 1,
                    },
                  },
                ],
              },
            },
            { $unwind: { path: '$listenerProfile', preserveNullAndEmptyArrays: true } },
            // Shape the output
            {
              $project: {
                _id: 1,
                followingId: 1,
                isFavorite: 1,
                createdAt: 1,
                user: 1,
                listenerProfile: 1,
              },
            },
          ],
        },
      },
    ];

    const result = await this.model.aggregate(pipeline);
    const total = result[0].metadata[0]?.total || 0;
    const data = result[0].data;

    return { total, data };
  }

  /**
   * Get paginated list of followers for a specific user/listener.
   */
  async getFollowers(followingId, skip, limit) {
    const pipeline = [
      { $match: { followingId: new mongoose.Types.ObjectId(followingId) } },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            // Lookup the follower user
            {
              $lookup: {
                from: 'users',
                localField: 'followerId',
                foreignField: '_id',
                as: 'user',
                pipeline: [
                  { $match: { isDeleted: false, isBlocked: false } },
                  { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
                ],
              },
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
            {
              $project: {
                _id: 1,
                followerId: 1,
                createdAt: 1,
                user: 1,
              },
            },
          ],
        },
      },
    ];

    const result = await this.model.aggregate(pipeline);
    const total = result[0].metadata[0]?.total || 0;
    const data = result[0].data;

    return { total, data };
  }

  /**
   * Get paginated favourites (following list filtered by isFavorite: true).
   */
  async getFavorites(followerId, skip, limit) {
    const pipeline = [
      {
        $match: {
          followerId: new mongoose.Types.ObjectId(followerId),
          isFavorite: true,
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: 'followingId',
                foreignField: '_id',
                as: 'user',
                pipeline: [
                  { $match: { isDeleted: false, isBlocked: false } },
                  { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
                ],
              },
            },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
            {
              $lookup: {
                from: 'listenerprofiles',
                localField: 'followingId',
                foreignField: 'userId',
                as: 'listenerProfile',
                pipeline: [
                  {
                    $project: {
                      bio: 1, categories: 1, avgRating: 1, totalRatings: 1,
                      chatRate: 1, voiceRate: 1, videoRate: 1, availability: 1,
                      followersCount: 1, profilePhotos: 1,
                    },
                  },
                ],
              },
            },
            { $unwind: { path: '$listenerProfile', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 1,
                followingId: 1,
                isFavorite: 1,
                createdAt: 1,
                user: 1,
                listenerProfile: 1,
              },
            },
          ],
        },
      },
    ];

    const result = await this.model.aggregate(pipeline);
    const total = result[0].metadata[0]?.total || 0;
    const data = result[0].data;

    return { total, data };
  }

  /**
   * Analytics: Get top followed listeners by aggregating Follow collection.
   */
  async getTopFollowedListeners(limit = 10) {
    return await this.model.aggregate([
      {
        $group: {
          _id: '$followingId',
          followersCount: { $sum: 1 },
        },
      },
      { $sort: { followersCount: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            { $project: { firstName: 1, lastName: 1, profileImage: 1, isOnline: 1 } },
          ],
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: 'listenerprofiles',
          localField: '_id',
          foreignField: 'userId',
          as: 'listenerProfile',
          pipeline: [
            {
              $project: {
                bio: 1, categories: 1, avgRating: 1, totalRatings: 1, availability: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: '$listenerProfile', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          listenerId: '$_id',
          followersCount: 1,
          user: 1,
          listenerProfile: 1,
        },
      },
    ]);
  }

  /**
   * Count followers for a specific user (fallback when cache misses).
   */
  async countFollowers(followingId) {
    return await this.model.countDocuments({ followingId });
  }

  /**
   * Count following for a specific user (fallback when cache misses).
   */
  async countFollowing(followerId) {
    return await this.model.countDocuments({ followerId });
  }
}

export default new FollowRepository();
