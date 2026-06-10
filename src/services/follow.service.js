import BaseService from './base.service.js';
import followRepository from '../repositories/follow.repository.js';
import userRepository from '../repositories/user.repository.js';
import listenerRepository from '../repositories/listener.repository.js';
import followEvents from '../events/follow.events.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import User from '../modules/user.model.js';

/**
 * Follow Service — Business logic, caching, and event orchestration.
 *
 * Key patterns:
 *   - Atomic follow/unfollow via repository upsert (race-condition safe)
 *   - Denormalized counters on ListenerProfile + User updated via $inc
 *   - Version-based Redis cache invalidation (same as wallet/listener services)
 *   - Event emission for analytics + notification hooks
 */
class FollowService extends BaseService {
  constructor() {
    super(followRepository);
  }

  // ─── FOLLOW ───────────────────────────────────────────────────────
  /**
   * Follow a listener. Idempotent — duplicate follows are silently ignored.
   * Race-condition safe via MongoDB unique index + atomic upsert.
   */
  async followUser(followerId, followingId) {
    // 1. Validate: cannot follow yourself
    if (followerId.toString() === followingId.toString()) {
      throw new ApiError(400, 'You cannot follow yourself');
    }

    // 2. Validate: followingId must be a LISTENER
    const targetUser = await userRepository.findById(followingId, 'type isDeleted isBlocked');
    if (!targetUser) {
      throw new ApiError(404, 'Listener not found');
    }
    if (targetUser.type !== 'LISTENER') {
      throw new ApiError(400, 'You can only follow listeners');
    }
    if (targetUser.isDeleted || targetUser.isBlocked) {
      throw new ApiError(400, 'This listener is not available');
    }

    // 3. Atomic upsert — idempotent, race-condition safe
    const { doc, isNewFollow } = await followRepository.follow(followerId, followingId);

    if (!isNewFollow) {
      return { followed: true, alreadyFollowing: true, doc };
    }

    // 4. Atomically increment denormalized counters (parallel)
    await Promise.all([
      ListenerProfile.updateOne({ userId: followingId }, { $inc: { followersCount: 1 } }),
      User.updateOne({ _id: followerId }, { $inc: { followingCount: 1 } }),
    ]);

    // 5. Invalidate caches
    await this._invalidateFollowCaches(followerId, followingId);

    // 6. Emit event (fire-and-forget, non-blocking)
    followEvents.emit('user:followed', { followerId, followingId, timestamp: new Date() });

    return { followed: true, alreadyFollowing: false, doc };
  }

  // ─── UNFOLLOW ─────────────────────────────────────────────────────
  /**
   * Unfollow a listener. Returns error if not currently following.
   */
  async unfollowUser(followerId, followingId) {
    const deleted = await followRepository.unfollow(followerId, followingId);

    if (!deleted) {
      throw new ApiError(400, 'You are not following this listener');
    }

    // Atomically decrement denormalized counters (parallel)
    await Promise.all([
      ListenerProfile.updateOne(
        { userId: followingId, followersCount: { $gt: 0 } },
        { $inc: { followersCount: -1 } }
      ),
      User.updateOne(
        { _id: followerId, followingCount: { $gt: 0 } },
        { $inc: { followingCount: -1 } }
      ),
    ]);

    // Invalidate caches
    await this._invalidateFollowCaches(followerId, followingId);

    // Emit event
    followEvents.emit('user:unfollowed', { followerId, followingId, timestamp: new Date() });

    return { unfollowed: true };
  }

  // ─── GET FOLLOWING LIST ───────────────────────────────────────────
  /**
   * Get paginated list of listeners that the user is following.
   * Version-based Redis cache for fast reads.
   */
  async getFollowing(userId, queryParams) {
    const { page, limit, skip } = getPaginationOptions(queryParams);

    const version = await getCacheVersion(`follow:${userId}`);
    const cacheKey = `follow:${userId}:list:v${version}:${page}:${limit}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { total, data } = await followRepository.getFollowing(userId, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300); // 5 min TTL
    return response;
  }

  // ─── GET FOLLOWERS LIST ───────────────────────────────────────────
  /**
   * Get paginated list of followers for a specific listener.
   */
  async getFollowers(listenerId, queryParams) {
    const { page, limit, skip } = getPaginationOptions(queryParams);

    const version = await getCacheVersion(`followers:${listenerId}`);
    const cacheKey = `followers:${listenerId}:list:v${version}:${page}:${limit}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { total, data } = await followRepository.getFollowers(listenerId, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300);
    return response;
  }

  // ─── GET FOLLOW COUNTS ────────────────────────────────────────────
  /**
   * Get follower + following counts for a user (reads from denormalized fields, cached).
   */
  async getFollowCounts(userId) {
    const cacheKey = `follow:counts:${userId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    // Read denormalized counts in parallel
    const [user, listenerProfile] = await Promise.all([
      User.findById(userId).select('followingCount type').lean(),
      ListenerProfile.findOne({ userId }).select('followersCount').lean(),
    ]);

    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    const counts = {
      followingCount: user.followingCount || 0,
      followersCount: listenerProfile?.followersCount || 0,
      isListener: user.type === 'LISTENER',
    };

    await setCache(cacheKey, counts, 600); // 10 min TTL
    return counts;
  }

  // ─── TOGGLE FAVORITE ──────────────────────────────────────────────
  /**
   * Mark/unmark a followed listener as favourite.
   * Must already be following the listener.
   */
  async toggleFavorite(followerId, followingId) {
    // Check if following first
    const existingFollow = await followRepository.isFollowing(followerId, followingId);
    if (!existingFollow) {
      throw new ApiError(400, 'You must follow this listener before marking as favourite');
    }

    const newFavoriteStatus = !existingFollow.isFavorite;
    const updatedDoc = await followRepository.toggleFavorite(followerId, followingId, newFavoriteStatus);

    // Invalidate following list cache (favorites are a subset)
    await bumpCacheVersion(`follow:${followerId}`);

    // Emit event
    followEvents.emit('user:favorite:toggled', {
      followerId,
      followingId,
      isFavorite: newFavoriteStatus,
    });

    return { isFavorite: newFavoriteStatus, doc: updatedDoc };
  }

  // ─── CHECK FOLLOW STATUS ─────────────────────────────────────────
  /**
   * Check if the authenticated user follows a specific listener.
   * Direct DB query with unique index — sub-20ms.
   */
  async checkFollowStatus(followerId, followingId) {
    const follow = await followRepository.isFollowing(followerId, followingId);
    return {
      isFollowing: !!follow,
      isFavorite: follow?.isFavorite || false,
    };
  }

  // ─── GET FAVORITES ────────────────────────────────────────────────
  /**
   * Get paginated list of favorite listeners.
   */
  async getFavorites(userId, queryParams) {
    const { page, limit, skip } = getPaginationOptions(queryParams);

    const version = await getCacheVersion(`follow:${userId}`);
    const cacheKey = `follow:${userId}:favs:v${version}:${page}:${limit}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { total, data } = await followRepository.getFavorites(userId, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300);
    return response;
  }

  // ─── TOP FOLLOWED (ANALYTICS) ────────────────────────────────────
  /**
   * Get top followed listeners. Admin analytics endpoint.
   * Cached for 10 minutes.
   */
  async getTopFollowed(limit = 10) {
    const version = await getCacheVersion('analytics:top-followed');
    const cacheKey = `analytics:top-followed:v${version}:${limit}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const topListeners = await followRepository.getTopFollowedListeners(limit);
    await setCache(cacheKey, topListeners, 600);

    return topListeners;
  }

  // ─── PRIVATE HELPERS ──────────────────────────────────────────────
  /**
   * Invalidate all follow-related caches for both parties.
   */
  async _invalidateFollowCaches(followerId, followingId) {
    await Promise.all([
      bumpCacheVersion(`follow:${followerId}`),
      bumpCacheVersion(`followers:${followingId}`),
      deleteCache(`follow:counts:${followerId}`),
      deleteCache(`follow:counts:${followingId}`),
      bumpCacheVersion('analytics:top-followed'),
    ]);
  }
}

export default new FollowService();
