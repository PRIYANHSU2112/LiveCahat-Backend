import BaseController from './base.controller.js';
import avatarService from '../services/avatar.service.js';
import catchAsync from '../utils/catchAsync.util.js';

function normalizeAvatarBody(body) {
  const data = { ...body };
  if (data.imageUrl && !data.image) {
    data.image = data.imageUrl;
  }
  delete data.imageUrl;
  return data;
}

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

  // Set avatar as profile image
  setAsProfile = catchAsync(async (req, res) => {
    const result = await avatarService.setAvatarAsProfile(req.user._id, req.params.avatarId);
    this.sendResponse(res, 200, 'Profile image updated successfully', result);
  });

  // Admin: Paginated catalog
  listAdmin = catchAsync(async (req, res) => {
    const data = await avatarService.getAdminAvatars(req.query);
    this.sendResponse(res, 200, 'Admin avatars fetched successfully', data);
  });

  // Admin: Catalog stats
  getAdminStats = catchAsync(async (req, res) => {
    const data = await avatarService.getAdminStats();
    this.sendResponse(res, 200, 'Avatar stats fetched successfully', data);
  });

  // Admin: Create avatar
  create = catchAsync(async (req, res) => {
    const data = await avatarService.createAvatar(normalizeAvatarBody(req.body));
    this.sendResponse(res, 201, 'Avatar created successfully', data);
  });

  // Admin: Update avatar
  update = catchAsync(async (req, res) => {
    const data = await avatarService.updateAvatar(req.params.id, normalizeAvatarBody(req.body));
    this.sendResponse(res, 200, 'Avatar updated successfully', data);
  });

  // Admin: Delete avatar
  delete = catchAsync(async (req, res) => {
    const data = await avatarService.deleteAvatar(req.params.id);
    this.sendResponse(res, 200, 'Avatar deleted successfully', data);
  });
}

export default new AvatarController();
