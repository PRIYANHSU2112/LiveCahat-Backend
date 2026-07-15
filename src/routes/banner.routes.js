import express from 'express';
import bannerController from '../controllers/banner.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createBannerSchema, updateBannerSchema, toggleActiveSchema } from '../validators/banner.validator.js';
import { uploadBannerImage, processAndUploadImage } from '../middlewares/upload.middleware.js';

const router = express.Router();

// User side: Get active banners (sorted by position)
router.get('/', authenticate, bannerController.getActiveBanners);

// Admin side: CRUD operations
router.use(authenticate, restrictTo('ADMIN'));

router.get('/admin/stats', authorize('banner.stats.view'), bannerController.getAdminStats);
router.post('/', authorize('banner.create'), uploadBannerImage, processAndUploadImage, validate(createBannerSchema), bannerController.createBanner);
router.get('/all', authorize('banner.read'), bannerController.getAllBanners);
router.get('/:id', authorize('banner.read'), bannerController.getBannerById);
router.put('/:id', authorize('banner.update'), uploadBannerImage, processAndUploadImage, validate(updateBannerSchema), bannerController.updateBanner);
router.delete('/:id', authorize('banner.delete'), bannerController.deleteBanner);
router.patch('/:id/toggle-active', authorize('banner.update'), validate(toggleActiveSchema), bannerController.toggleActiveStatus);

export default router;
