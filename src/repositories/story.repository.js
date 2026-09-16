import BaseRepository from './base.repository.js';
import Story from '../modules/story.model.js';
import mongoose from 'mongoose';

/**
 * Story Repository - High-performance database operations for Stories.
 */
class StoryRepository extends BaseRepository {
  constructor() {
    super(Story);
  }

  /**
   * Find all active stories belonging to a list of candidate owner IDs.
   * Utilizes the compound index: { ownerId: 1, status: 1, expiresAt: 1, createdAt: -1 }
   */
  async findActiveStoriesByOwners(ownerIds, now = new Date()) {
    if (!ownerIds || ownerIds.length === 0) return [];

    const objectIds = ownerIds.map((id) =>
      id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)
    );

    return await this.model
      .find({
        ownerId: { $in: objectIds },
        status: 'ACTIVE',
        $or: [{ type: 'LIVE' }, { expiresAt: { $gt: now } }],
      })
      .select('ownerId type status fileKey mediaUrl thumbnailUrl caption text metadata duration visibility liveSessionId viewsCount expiresAt createdAt')
      .populate('ownerId', 'firstName lastName profileImage type isOnline')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Find all active stories for a specific owner in playback order (oldest to newest).
   */
  async findActiveStoriesByOwner(ownerId, now = new Date()) {
    const ownerObjectId =
      ownerId instanceof mongoose.Types.ObjectId ? ownerId : new mongoose.Types.ObjectId(ownerId);

    return await this.model
      .find({
        ownerId: ownerObjectId,
        status: 'ACTIVE',
        $or: [{ type: 'LIVE' }, { expiresAt: { $gt: now } }],
      })
      .select('ownerId type status fileKey mediaUrl thumbnailUrl caption text metadata duration visibility liveSessionId viewsCount expiresAt createdAt')
      .populate('ownerId', 'firstName lastName profileImage type isOnline')
      .populate('liveSessionId', 'channelName title mode status viewerCount startedAt')
      .sort({ createdAt: 1 })
      .lean();
  }

  /**
   * Find an active story by ID.
   */
  async findActiveById(storyId, now = new Date()) {
    return await this.model
      .findOne({
        _id: storyId,
        status: 'ACTIVE',
        $or: [{ type: 'LIVE' }, { expiresAt: { $gt: now } }],
      })
      .populate('ownerId', 'firstName lastName profileImage type isOnline')
      .populate('liveSessionId', 'channelName title mode status viewerCount startedAt')
      .lean();
  }

  /**
   * Atomically increment the view count of a story.
   */
  async incrementViewCount(storyId) {
    return await this.model.findByIdAndUpdate(
      storyId,
      { $inc: { viewsCount: 1 } },
      { new: true, lean: true }
    );
  }

  /**
   * Batch mark expired non-live stories as EXPIRED.
   */
  async markExpired(now = new Date()) {
    return await this.model.updateMany(
      {
        status: 'ACTIVE',
        type: { $ne: 'LIVE' },
        expiresAt: { $lte: now },
      },
      {
        $set: { status: 'EXPIRED' },
      }
    );
  }

  /**
   * Mark a live story as ENDED when the live session terminates.
   */
  async markLiveStoryEnded(liveSessionId) {
    return await this.model.updateMany(
      {
        liveSessionId,
        status: 'ACTIVE',
      },
      {
        $set: { status: 'ENDED' },
      }
    );
  }

  /**
   * Check if an owner has any active stories remaining (for ZSET pruning).
   */
  async countActiveStoriesForOwner(ownerId, now = new Date()) {
    return await this.model.countDocuments({
      ownerId,
      status: 'ACTIVE',
      $or: [{ type: 'LIVE' }, { expiresAt: { $gt: now } }],
    });
  }

  /**
   * Get the timestamp of the newest active story for an owner.
   */
  async getLatestActiveStoryForOwner(ownerId, now = new Date()) {
    return await this.model
      .findOne({
        ownerId,
        status: 'ACTIVE',
        $or: [{ type: 'LIVE' }, { expiresAt: { $gt: now } }],
      })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
  }
}

export default new StoryRepository();
