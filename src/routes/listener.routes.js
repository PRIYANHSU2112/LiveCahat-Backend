import express from 'express';
import listenerController from '../controllers/listener.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { uploadKYCDocuments, uploadIntroVideo, processAndUploadImage } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updateListenerProfileSchema, updateRatesSchema, updateAvailabilitySchema, updateKycStatusSchema, dashboardOverviewQuerySchema, dashboardSessionsQuerySchema, homeListenersQuerySchema } from '../validators/listener.validator.js';

const router = express.Router();

router.use(authenticate);

// Listeners can access these
router.use(restrictTo('LISTENER', 'CUSTOMER')); // Customer can become a listener by creating a profile

router.get('/profile', listenerController.getProfile);

router.put('/profile', uploadIntroVideo, processAndUploadImage, validate(updateListenerProfileSchema), listenerController.updateProfile);

router.post('/kyc', uploadKYCDocuments, processAndUploadImage, listenerController.submitKyc);

router.put('/rates', restrictTo('LISTENER'), validate(updateRatesSchema), listenerController.updateRates);

router.put('/availability', restrictTo('LISTENER'), validate(updateAvailabilitySchema), listenerController.updateAvailability);

router.patch('/availability/toggle', restrictTo('LISTENER'), listenerController.toggleAvailability);

// --- DASHBOARD (LISTENER ONLY) ---

router.get('/dashboard', restrictTo('LISTENER'), listenerController.getDashboard);

router.get('/dashboard/overview', restrictTo('LISTENER'), validate(dashboardOverviewQuerySchema), listenerController.getDashboardOverview);

router.get('/dashboard/sessions', restrictTo('LISTENER'), validate(dashboardSessionsQuerySchema), listenerController.getRecentSessions);

// --- ADMIN ONLY ROUTES ---

router.get('/', restrictTo('ADMIN', 'CUSTOMER'), listenerController.getAllListeners);

router.post('/:id/kyc', restrictTo('ADMIN'), validate(updateKycStatusSchema), listenerController.approveOrRejectListener);

export default router;
