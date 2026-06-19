import BaseController from './base.controller.js';
import stickerCategoryService from '../services/sticker-category.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class StickerCategoryController extends BaseController {
  // ─── Shared (User + Admin) ──────────────────────────────────────

  getAllCategories = catchAsync(async (req, res) => {
    const forAdmin = req.user && req.user.type === 'ADMIN';
    const data = await stickerCategoryService.getCategories(req.query, forAdmin);
    this.sendResponse(res, 200, 'Sticker categories fetched successfully', data);
  });

  getCategoryById = catchAsync(async (req, res) => {
    const data = await stickerCategoryService.getCategoryById(req.params.id);
    this.sendResponse(res, 200, 'Sticker category fetched successfully', data);
  });

  // ─── Admin only ─────────────────────────────────────────────────

  createCategory = catchAsync(async (req, res) => {
    const data = await stickerCategoryService.createCategory(req.body);
    this.sendResponse(res, 201, 'Sticker category created successfully', data);
  });

  updateCategory = catchAsync(async (req, res) => {
    const data = await stickerCategoryService.updateCategory(req.params.id, req.body);
    this.sendResponse(res, 200, 'Sticker category updated successfully', data);
  });

  toggleCategory = catchAsync(async (req, res) => {
    const data = await stickerCategoryService.toggleCategoryStatus(req.params.id);
    const status = data.isActive ? 'activated' : 'deactivated';
    this.sendResponse(res, 200, `Sticker category ${status} successfully`, data);
  });

  deleteCategory = catchAsync(async (req, res) => {
    await stickerCategoryService.deleteCategory(req.params.id);
    this.sendResponse(res, 200, 'Sticker category deleted successfully');
  });
}

export default new StickerCategoryController();
