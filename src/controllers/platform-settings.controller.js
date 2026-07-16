import BaseController from './base.controller.js';
import catchAsync from '../utils/catchAsync.util.js';
import platformSettingsService from '../services/platform-settings.service.js';

class PlatformSettingsController extends BaseController {
  getSettings = catchAsync(async (req, res) => {
    const data = await platformSettingsService.getSettings();
    this.sendResponse(res, 200, 'Platform settings fetched successfully', data);
  });

  updateSettings = catchAsync(async (req, res) => {
    const data = await platformSettingsService.updateSettings(req.body, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Platform settings updated successfully', data);
  });
}

export default new PlatformSettingsController();
