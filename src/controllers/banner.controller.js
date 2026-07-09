import BaseController from './base.controller.js';
import bannerService from '../services/banner.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class BannerController extends BaseController {

  // User side API
  getActiveBanners = catchAsync(async (req, res) => {
    const banners = await bannerService.getActiveBanners();
    this.sendResponse(res, 200, 'Active banners fetched successfully', banners);
  });

  getAdminStats = catchAsync(async (req, res) => {
    const data = await bannerService.getAdminStats();
    this.sendResponse(res, 200, 'Banner stats fetched successfully', data);
  });

  // Admin CRUD APIs
  createBanner = catchAsync(async (req, res) => {
    const banner = await bannerService.createBanner(req.body);
    this.sendResponse(res, 201, 'Banner created successfully', banner);
  });

  getAllBanners = catchAsync(async (req, res) => {
    const data = await bannerService.getAllBanners(req.query);
    this.sendResponse(res, 200, 'All banners fetched successfully', data);
  });

  getBannerById = catchAsync(async (req, res) => {
    const banner = await bannerService.getItemById(req.params.id);
    if (!banner) {
      return this.sendError(res, 404, 'Banner not found');
    }
    this.sendResponse(res, 200, 'Banner fetched successfully', banner);
  });

  updateBanner = catchAsync(async (req, res) => {
    const banner = await bannerService.updateBanner(req.params.id, req.body);
    if (!banner) {
      return this.sendError(res, 404, 'Banner not found');
    }
    this.sendResponse(res, 200, 'Banner updated successfully', banner);
  });

  deleteBanner = catchAsync(async (req, res) => {
    const result = await bannerService.deleteBanner(req.params.id);
    if (!result) {
      return this.sendError(res, 404, 'Banner not found');
    }
    this.sendResponse(res, 200, 'Banner deleted successfully');
  });

  toggleActiveStatus = catchAsync(async (req, res) => {
    const { isActive } = req.body;
    const banner = await bannerService.updateBanner(req.params.id, { isActive });
    if (!banner) {
      return this.sendError(res, 404, 'Banner not found');
    }
    this.sendResponse(res, 200, `Banner successfully ${isActive ? 'activated' : 'deactivated'}`, banner);
  });
}

export default new BannerController();
