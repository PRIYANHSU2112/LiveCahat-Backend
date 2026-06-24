import BaseController from './base.controller.js';
import searchService from '../services/search.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class SearchController extends BaseController {

  /**
   * GET /search/listeners
   * Public user-facing search — find listeners by name, country, language, category.
   * Requires authentication (any logged-in user).
   */
  searchListeners = catchAsync(async (req, res) => {
    const result = await searchService.searchListeners(req.query);
    this.sendResponse(res, 200, 'Listeners search results fetched successfully', result);
  });

  /**
   * GET /search/admin
   * Admin-facing global search — full filters across all users and listener profiles.
   * Restricted to ADMIN role only.
   */
  adminGlobalSearch = catchAsync(async (req, res) => {
    const result = await searchService.adminGlobalSearch(req.query);
    this.sendResponse(res, 200, 'Admin search results fetched successfully', result);
  });
}

export default new SearchController();
