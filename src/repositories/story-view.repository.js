import BaseRepository from './base.repository.js';
import StoryView from '../modules/story-view.model.js';
import mongoose from 'mongoose';

/**
 * StoryView Repository - High-throughput batch view recording and queries.
 */
class StoryViewRepository extends BaseRepository {
  constructor() {
    super(StoryView);
  }

  /**
   * Batch upsert story views using MongoDB bulkWrite.
   * Atomic, idempotent, and non-blocking under high concurrent load.
   *
   * @param {string|ObjectId} viewerId - The user viewing the stories
   * @param {Array<{ storyId: string|ObjectId, storyOwnerId: string|ObjectId }>} entries
   * @returns {Promise<{ upsertedCount: number, upsertedStoryIds: Array<string> }>}
   */
  async batchRecordViews(viewerId, entries) {
    if (!entries || entries.length === 0) {
      return { upsertedCount: 0, upsertedStoryIds: [] };
    }

    const viewerObjectId =
      viewerId instanceof mongoose.Types.ObjectId ? viewerId : new mongoose.Types.ObjectId(viewerId);

    const operations = entries.map((entry) => ({
      updateOne: {
        filter: {
          storyId: entry.storyId,
          viewerId: viewerObjectId,
        },
        update: {
          $setOnInsert: {
            storyId: entry.storyId,
            viewerId: viewerObjectId,
            storyOwnerId: entry.storyOwnerId,
            viewedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await this.model.bulkWrite(operations, { ordered: false });

    // Extract storyIds that were newly upserted (first time viewed)
    const upsertedIndices = Object.keys(result.upsertedIds || {});
    const upsertedStoryIds = upsertedIndices.map((idx) => {
      const entry = entries[parseInt(idx, 10)];
      return entry ? entry.storyId.toString() : null;
    }).filter(Boolean);

    return {
      upsertedCount: result.upsertedCount,
      upsertedStoryIds,
    };
  }

  /**
   * Query which storyIds from a candidate list have been viewed by viewerId.
   */
  async getViewedStoryIdsForViewer(viewerId, storyIds) {
    if (!storyIds || storyIds.length === 0) return [];

    const viewerObjectId =
      viewerId instanceof mongoose.Types.ObjectId ? viewerId : new mongoose.Types.ObjectId(viewerId);

    const docs = await this.model
      .find({
        viewerId: viewerObjectId,
        storyId: { $in: storyIds },
      })
      .select('storyId')
      .lean();

    return docs.map((d) => d.storyId.toString());
  }

  /**
   * Get viewers for a specific story (for the story author).
   */
  async getStoryViewers(storyId, limit = 50) {
    return await this.model
      .find({ storyId })
      .sort({ viewedAt: -1 })
      .limit(limit)
      .populate('viewerId', 'firstName lastName profileImage type')
      .lean();
  }
}

export default new StoryViewRepository();
