import BaseController from './base.controller.js';
import matchService from '../services/match.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class MatchController extends BaseController {
  getMatchFee = catchAsync(async (req, res) => {
    const data = await matchService.getMatchFee();
    this.sendResponse(res, 200, 'Match fee fetched successfully', data);
  });

  getMatchConfig = catchAsync(async (req, res) => {
    const data = await matchService.getMatchConfig();
    this.sendResponse(res, 200, 'Match config fetched successfully', data);
  });

  updateMatchConfig = catchAsync(async (req, res) => {
    const data = await matchService.updateMatchConfig(req.body);
    this.sendResponse(res, 200, 'Match config updated successfully', data);
  });

  instantMatch = catchAsync(async (req, res) => {
    const data = await matchService.instantMatch(req.user._id, req.user, req.body);
    this.sendResponse(res, 200, 'Partner matched successfully', data);
  });

  matchStatus = catchAsync(async (req, res) => {
    const data = await matchService.matchStatus(req.user, req.query);
    this.sendResponse(res, 200, 'Match status fetched successfully', data);
  });

  discoverListeners = catchAsync(async (req, res) => {
    const result = await matchService.discoverListeners(req.user, req.query);
    this.sendResponse(res, 200, 'Listeners discovered successfully', result);
  });
}

export default new MatchController();
