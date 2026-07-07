import express from 'express';
import listenerController from '../controllers/listener.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { uploadKYCDocuments, uploadIntroVideo, processAndUploadImage } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updateListenerProfileSchema, updateRatesSchema, updateAvailabilitySchema, updateKycStatusSchema, dashboardOverviewQuerySchema, dashboardSessionsQuerySchema, homeListenersQuerySchema, agentCreateListenerSchema, agentListenersQuerySchema } from '../validators/listener.validator.js';

const router = express.Router();

router.use(authenticate);

// --- AGENT ONLY ROUTES (must precede the LISTENER/CUSTOMER restriction below) ---
router.get('/agent', restrictTo('AGENT'), validate(agentListenersQuerySchema), listenerController.getAgentListeners);
router.get('/agent/stats', restrictTo('AGENT'), listenerController.getAgentStats);
router.post('/agent', restrictTo('AGENT'), validate(agentCreateListenerSchema), listenerController.createListener);

// --- ADMIN ONLY ROUTES (must precede the LISTENER/CUSTOMER restriction below) ---
router.get('/admin/stats', restrictTo('ADMIN'), listenerController.getAdminStats);
router.get('/admin/performance', restrictTo('ADMIN'), listenerController.getAdminListenerPerformance);
router.get('/admin/availability-monitoring', restrictTo('ADMIN'), listenerController.getAdminAvailabilityMonitoring);
router.get('/admin/:id', restrictTo('ADMIN'), listenerController.getListenerById);
router.put('/admin/:id', restrictTo('ADMIN'), listenerController.updateListenerByAdmin);
router.get('/', restrictTo('ADMIN', 'CUSTOMER'), listenerController.getAllListeners);
router.post('/:id/kyc', restrictTo('ADMIN'), validate(updateKycStatusSchema), listenerController.approveOrRejectListener);

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

export default router;
