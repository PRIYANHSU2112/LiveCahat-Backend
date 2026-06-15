import express from 'express';
import bannerController from '../controllers/banner.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createBannerSchema, updateBannerSchema, toggleActiveSchema } from '../validators/banner.validator.js';
import { uploadBannerImage, processAndUploadImage } from '../middlewares/upload.middleware.js';

const router = express.Router();

// User side: Get active banners (sorted by position)
router.get('/', authenticate, bannerController.getActiveBanners);

// Admin side: CRUD operations
router.use(authenticate, restrictTo('ADMIN'));

router.post('/', uploadBannerImage, processAndUploadImage, validate(createBannerSchema), bannerController.createBanner);
router.get('/all', bannerController.getAllBanners);
router.get('/:id', bannerController.getBannerById);
router.put('/:id', uploadBannerImage, processAndUploadImage, validate(updateBannerSchema), bannerController.updateBanner);
router.delete('/:id', bannerController.deleteBanner);
router.patch('/:id/toggle-active', validate(toggleActiveSchema), bannerController.toggleActiveStatus);

export default router;
