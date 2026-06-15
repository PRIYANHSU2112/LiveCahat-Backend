import BaseController from './base.controller.js';
import wishlistService from '../services/wishlist.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class WishlistController extends BaseController {

  /**
   * Add a listener to user's wishlist
   */
  addToWishlist = catchAsync(async (req, res) => {
    const item = await wishlistService.addToWishlist(req.user._id, req.params.listenerId);
    this.sendResponse(res, 201, 'Listener added to wishlist successfully', item);
  });

  /**
   * Remove a listener from user's wishlist
   */
  removeFromWishlist = catchAsync(async (req, res) => {
    await wishlistService.removeFromWishlist(req.user._id, req.params.listenerId);
    this.sendResponse(res, 200, 'Listener removed from wishlist successfully');
  });

  /**
   * Get user's paginated wishlist
   */
  getWishlist = catchAsync(async (req, res) => {
    const response = await wishlistService.getWishlist(req.user._id, req.query);
    this.sendResponse(res, 200, 'Wishlist fetched successfully', response);
  });

  /**
   * Check if a listener is in user's wishlist
   */
  checkStatus = catchAsync(async (req, res) => {
    const status = await wishlistService.checkWishlistStatus(req.user._id, req.params.listenerId);
    this.sendResponse(res, 200, 'Wishlist status checked successfully', status);
  });
}

export default new WishlistController();
