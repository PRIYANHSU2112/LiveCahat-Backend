import BaseService from './base.service.js';
import wishlistRepository from '../repositories/wishlist.repository.js';
import userRepository from '../repositories/user.repository.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

class WishlistService extends BaseService {
  constructor() {
    super(wishlistRepository);
  }

  /**
   * Add a listener to user's wishlist.
   */
  async addToWishlist(userId, listenerId) {
    // 1. Prevent self-wishlist
    if (userId.toString() === listenerId.toString()) {
      throw new ApiError(400, 'You cannot add yourself to your wishlist');
    }

    // 2. Validate listener existence and type
    const targetUser = await userRepository.findById(listenerId, 'type isDeleted isBlocked');
    if (!targetUser) {
      throw new ApiError(404, 'Listener not found');
    }
    if (targetUser.type !== 'LISTENER') {
      throw new ApiError(400, 'You can only add listeners to your wishlist');
    }
    if (targetUser.isDeleted || targetUser.isBlocked) {
      throw new ApiError(400, 'This listener is not available');
    }

    // 3. Atomically add to wishlist
    const doc = await this.repository.add(userId, listenerId);

    // 4. Invalidate wishlist cache
    await Promise.all([
      bumpCacheVersion(`wishlist:${userId}`),
      deleteCache(`wishlist:status:${userId}:${listenerId}`)
    ]);

    return doc;
  }

  /**
   * Remove a listener from user's wishlist.
   */
  async removeFromWishlist(userId, listenerId) {
    // 1. Atomically remove from database
    const deleted = await this.repository.remove(userId, listenerId);
    if (!deleted) {
      throw new ApiError(400, 'This listener is not in your wishlist');
    }

    // 2. Invalidate wishlist cache
    await Promise.all([
      bumpCacheVersion(`wishlist:${userId}`),
      deleteCache(`wishlist:status:${userId}:${listenerId}`)
    ]);

    return { removed: true };
  }

  /**
   * Get paginated list of wishlisted listeners.
   */
  async getWishlist(userId, queryParams) {
    const { page, limit, skip } = getPaginationOptions(queryParams);

    const version = await getCacheVersion(`wishlist:${userId}`);
    const cacheKey = `wishlist:${userId}:list:v${version}:${page}:${limit}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const { total, data } = await this.repository.getWishlist(userId, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300); // cache for 5 minutes
    return response;
  }

  /**
   * Check if a listener is wishlisted by user.
   */
  async checkWishlistStatus(userId, listenerId) {
    const cacheKey = `wishlist:status:${userId}:${listenerId}`;
    const cached = await getCache(cacheKey);
    if (cached !== null) return { isWishlisted: cached === 'true' };

    const item = await this.repository.isWishlisted(userId, listenerId);
    const isWishlisted = !!item;

    await setCache(cacheKey, isWishlisted ? 'true' : 'false', 300); // cache for 5 minutes
    return { isWishlisted };
  }
}

export default new WishlistService();
