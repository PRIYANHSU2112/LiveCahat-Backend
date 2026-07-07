import BaseController from './base.controller.js';
import stickerService from '../services/sticker.service.js';
import catchAsync from '../utils/catchAsync.util.js';

function normalizeStickerBody(body) {
  const data = { ...body };
  if (data.imageUrl && !data.image) {
    data.image = data.imageUrl;
  }
  delete data.imageUrl;
  return data;
}

class StickerController extends BaseController {
  // ─── Shared (User + Admin) ──────────────────────────────────────

  getAllStickers = catchAsync(async (req, res) => {
    const data = await stickerService.getStickers(req.query, req.user);
    this.sendResponse(res, 200, 'Stickers fetched successfully', data);
  });

  getStickerById = catchAsync(async (req, res) => {
    const data = await stickerService.getStickerById(req.params.id, req.user);
    this.sendResponse(res, 200, 'Sticker fetched successfully', data);
  });

  // Purchase a PAID sticker with coins
  unlockSticker = catchAsync(async (req, res) => {
    const data = await stickerService.unlockSticker(req.user._id, req.params.id);
    this.sendResponse(res, 200, data.message, data);
  });

  // ─── Admin only ─────────────────────────────────────────────────

  createSticker = catchAsync(async (req, res) => {
    const data = await stickerService.createSticker(normalizeStickerBody(req.body));
    this.sendResponse(res, 201, 'Sticker created successfully', data);
  });

  updateSticker = catchAsync(async (req, res) => {
    const data = await stickerService.updateSticker(req.params.id, normalizeStickerBody(req.body));
    this.sendResponse(res, 200, 'Sticker updated successfully', data);
  });

  toggleSticker = catchAsync(async (req, res) => {
    const data = await stickerService.toggleStickerStatus(req.params.id);
    const status = data.isActive ? 'activated' : 'deactivated';
    this.sendResponse(res, 200, `Sticker ${status} successfully`, data);
  });

  deleteSticker = catchAsync(async (req, res) => {
    await stickerService.deleteSticker(req.params.id);
    this.sendResponse(res, 200, 'Sticker deleted successfully');
  });

  getAdminStats = catchAsync(async (req, res) => {
    const data = await stickerService.getAdminStats();
    this.sendResponse(res, 200, 'Sticker stats fetched successfully', data);
  });
}

export default new StickerController();
