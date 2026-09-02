import BaseController from './base.controller.js';
import visibilityBoostService from '../services/visibility-boost.service.js';
import catchAsync from '../utils/catchAsync.util.js';

/**
 * Controller for Listener Visibility Boost endpoints.
 */
class VisibilityBoostController extends BaseController {
  /**
   * POST /api/v1/listeners/visibility-boost
   * Purchase a visibility boost for the authenticated listener.
   */
  purchaseBoost = catchAsync(async (req, res) => {
    const result = await visibilityBoostService.purchase(
      req.user._id,
      req.body.idempotencyKey
    );
    const message = result.idempotent
      ? 'Boost already purchased (idempotent)'
      : 'Visibility boost purchased successfully';
    this.sendResponse(res, 201, message, result);
  });

  /**
   * GET /api/v1/listeners/visibility-boost/me
   * Get the listener's current active boost.
   */
  getMyBoost = catchAsync(async (req, res) => {
    const boost = await visibilityBoostService.getMyBoost(req.user._id);
    this.sendResponse(
      res,
      200,
      boost ? 'Active boost fetched' : 'No active boost',
      boost
    );
  });

  /**
   * GET /api/v1/listeners/admin/boost-config
   * Admin: Get boost configuration.
   */
  getConfig = catchAsync(async (req, res) => {
    const config = await visibilityBoostService.getConfig();
    this.sendResponse(res, 200, 'Boost configuration fetched', config);
  });

  /**
   * PUT /api/v1/listeners/admin/boost-config
   * Admin: Update boost configuration.
   */
  updateConfig = catchAsync(async (req, res) => {
    const config = await visibilityBoostService.updateConfig(req.body);
    this.sendResponse(res, 200, 'Boost configuration updated', config);
  });

  /**
   * GET /api/v1/listeners/admin/active-boosts
   * Admin: List all currently active boosts.
   */
  getActiveBoosts = catchAsync(async (req, res) => {
    const boosts = await visibilityBoostService.getActiveBoosts();
    this.sendResponse(res, 200, 'Active boosts fetched', boosts);
  });
}

export default new VisibilityBoostController();
