import BaseController from './base.controller.js';
import agentService from '../services/agent.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class AgentController extends BaseController {
  getRevenueSummary = catchAsync(async (req, res) => {
    const data = await agentService.getSummary(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent revenue summary fetched successfully', data);
  });

  getRevenueGraphs = catchAsync(async (req, res) => {
    const data = await agentService.getGraphs(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent revenue graphs fetched successfully', data);
  });

  getRevenueHistory = catchAsync(async (req, res) => {
    const data = await agentService.getHistory(req.user._id, req.query);
    this.sendResponse(res, 200, 'Agent commission history fetched successfully', data);
  });
}

export default new AgentController();
