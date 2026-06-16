import BaseController from './base.controller.js';
import avatarService from '../services/avatar.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class AvatarController extends BaseController {
  // Get active avatars list (annotated with isUnlocked)
  list = catchAsync(async (req, res) => {
    const data = await avatarService.getAvatars(req.user._id);
    this.sendResponse(res, 200, 'Avatars list fetched successfully', data);
  });

  // Unlock a paid avatar
  unlock = catchAsync(async (req, res) => {
    const result = await avatarService.unlockAvatar(req.user._id, req.params.avatarId);
    this.sendResponse(res, 200, result.message, result);
  });

  // Admin: Create avatar
  create = catchAsync(async (req, res) => {
    const data = await avatarService.createAvatar(req.body);
    this.sendResponse(res, 201, 'Avatar created successfully', data);
  });

  // Admin: Update avatar
  update = catchAsync(async (req, res) => {
    const data = await avatarService.updateAvatar(req.params.id, req.body);
    this.sendResponse(res, 200, 'Avatar updated successfully', data);
  });

  // Admin: Delete avatar
  delete = catchAsync(async (req, res) => {
    const data = await avatarService.deleteAvatar(req.params.id);
    this.sendResponse(res, 200, 'Avatar deleted successfully', data);
  });
}

export default new AvatarController();
