import BaseController from './base.controller.js';
import followService from '../services/follow.service.js';
import catchAsync from '../utils/catchAsync.util.js';

/**
 * Follow Controller — HTTP handlers for all follow operations.
 */
class FollowController extends BaseController {

  /**
   * Follow a listener
   * POST /follows/:listenerId
   */
  follow = catchAsync(async (req, res) => {
    const result = await followService.followUser(req.user._id, req.params.listenerId);
    const message = result.alreadyFollowing ? 'Already following this listener' : 'Followed successfully';
    this.sendResponse(res, 200, message, result);
  });

  /**
   * Unfollow a listener
   * DELETE /follows/:listenerId
   */
  unfollow = catchAsync(async (req, res) => {
    const result = await followService.unfollowUser(req.user._id, req.params.listenerId);
    this.sendResponse(res, 200, 'Unfollowed successfully', result);
  });

  /**
   * Get list of listeners the current user is following
   * GET /follows/following
   */
  getFollowing = catchAsync(async (req, res) => {
    const result = await followService.getFollowing(req.user._id, req.query);
    this.sendResponse(res, 200, 'Following list fetched successfully', result);
  });

  /**
   * Get followers list for a specific listener
   * GET /follows/followers/:listenerId
   */
  getFollowers = catchAsync(async (req, res) => {
    const result = await followService.getFollowers(req.params.listenerId, req.query);
    this.sendResponse(res, 200, 'Followers list fetched successfully', result);
  });

  /**
   * Get follow counts for a user
   * GET /follows/counts/:userId
   */
  getFollowCounts = catchAsync(async (req, res) => {
    const result = await followService.getFollowCounts(req.params.userId);
    this.sendResponse(res, 200, 'Follow counts fetched successfully', result);
  });

  /**
   * Toggle favourite status on a followed listener
   * PATCH /follows/favorite/:listenerId
   */
  toggleFavorite = catchAsync(async (req, res) => {
    const result = await followService.toggleFavorite(req.user._id, req.params.listenerId);
    const message = result.isFavorite ? 'Listener marked as favourite' : 'Listener removed from favourites';
    this.sendResponse(res, 200, message, result);
  });

  /**
   * Check if current user follows a specific listener
   * GET /follows/status/:listenerId
   */
  checkStatus = catchAsync(async (req, res) => {
    const result = await followService.checkFollowStatus(req.user._id, req.params.listenerId);
    this.sendResponse(res, 200, 'Follow status fetched', result);
  });

  /**
   * Get current user's favourite listeners
   * GET /follows/favorites
   */
  getFavorites = catchAsync(async (req, res) => {
    const result = await followService.getFavorites(req.user._id, req.query);
    this.sendResponse(res, 200, 'Favourites list fetched successfully', result);
  });

  // ─── ADMIN ──────────────────────────────────────────────────────

  /**
   * Get top followed listeners (analytics)
   * GET /follows/top
   */
  getTopFollowed = catchAsync(async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 10;
    const result = await followService.getTopFollowed(limit);
    this.sendResponse(res, 200, 'Top followed listeners fetched', result);
  });
}

export default new FollowController();
