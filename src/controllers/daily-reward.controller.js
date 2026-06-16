import BaseController from './base.controller.js';
import dailyRewardService from '../services/daily-reward.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class DailyRewardController extends BaseController {
  // Get current user daily reward state and previews
  getState = catchAsync(async (req, res) => {
    const data = await dailyRewardService.getDailyRewardState(req.user._id, req.query.date);
    this.sendResponse(res, 200, 'Daily reward state retrieved successfully', data);
  });

  // Claim today's daily reward
  claimReward = catchAsync(async (req, res) => {
    const result = await dailyRewardService.claimDailyReward(req.user._id, req.body.date);
    this.sendResponse(res, 200, result.message, result);
  });

  // Get current user's chests/gifts inventory
  getInventory = catchAsync(async (req, res) => {
    const data = await dailyRewardService.getUserInventory(req.user._id);
    this.sendResponse(res, 200, 'User inventory fetched successfully', data);
  });

  // Open an unopened chest or gift from the inventory
  openInventoryGift = catchAsync(async (req, res) => {
    const result = await dailyRewardService.openInventoryGift(req.user._id, req.params.inventoryId);
    this.sendResponse(res, 200, result.message, result);
  });

  // Admin: Update configurations for 7 days rewards cycle
  updateDaysConfig = catchAsync(async (req, res) => {
    const result = await dailyRewardService.updateDaysConfig(req.body.configs);
    this.sendResponse(res, 200, result.message);
  });

  // Admin: Update configurations for 4 weeks special gifts cycle
  updateWeeksConfig = catchAsync(async (req, res) => {
    const result = await dailyRewardService.updateWeeksConfig(req.body.configs);
    this.sendResponse(res, 200, result.message);
  });

  // Admin: Clear daily reward configurations cache
  clearCache = catchAsync(async (req, res) => {
    await dailyRewardService.clearCache();
    this.sendResponse(res, 200, 'Daily rewards configurations cache cleared successfully');
  });
}

export default new DailyRewardController();
