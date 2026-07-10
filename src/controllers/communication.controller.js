import BaseController from './base.controller.js';
import catchAsync from '../utils/catchAsync.util.js';
import adminCommunicationService from '../services/admin-communication.service.js';

class CommunicationController extends BaseController {
  getStats = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.getStats(req.query);
    this.sendResponse(res, 200, 'Communication session stats fetched successfully', data);
  });

  listSessions = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.listSessions(req.query);
    this.sendResponse(res, 200, 'Communication sessions fetched successfully', data);
  });

  getLiveSessions = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.getLiveSessions(req.query);
    this.sendResponse(res, 200, 'Live communication sessions fetched successfully', data);
  });

  getSessionDetail = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.getSessionDetail(req.params.sessionId);
    this.sendResponse(res, 200, 'Communication session detail fetched successfully', data);
  });

  forceEndSession = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.forceEndSession(
      req.params.sessionId,
      req.user?.id
    );
    this.sendResponse(res, 200, 'Session force-ended successfully', data);
  });

  getConfig = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.getConfig();
    this.sendResponse(res, 200, 'Communication config fetched successfully', data);
  });

  updateConfig = catchAsync(async (req, res) => {
    const data = await adminCommunicationService.updateConfig(req.body);
    this.sendResponse(res, 200, 'Communication config updated successfully', data);
  });
}

export default new CommunicationController();
