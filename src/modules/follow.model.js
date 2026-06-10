import mongoose from 'mongoose';

/**
 * Follow Model — Adjacency List pattern for scalable follow relationships.
 *
 * Design decisions:
 *   - Separate collection (not embedded array) → no 16MB BSON limit, scales to millions.
 *   - Unique compound index on (followerId, followingId) → atomic duplicate prevention.
 *   - Covering indexes for all paginated queries → sub-100ms at 10M+ docs.
 *   - isFavorite flag → user can mark followed listeners as favourites.
 */
const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    followingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isFavorite: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────
// 1. UNIQUE compound — prevents duplicate follows (race-condition safe)
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

// 2. "My following" list — sorted by newest first
followSchema.index({ followerId: 1, createdAt: -1 });

// 3. "My followers" list — sorted by newest first
followSchema.index({ followingId: 1, createdAt: -1 });

// 4. Filtered favourites query
followSchema.index({ followerId: 1, isFavorite: 1, createdAt: -1 });

const Follow = mongoose.model('Follow', followSchema);
export default Follow;
