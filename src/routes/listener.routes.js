import express from 'express';
import listenerController from '../controllers/listener.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { uploadKYCDocuments, uploadIntroVideo, processAndUploadImage } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { updateListenerProfileSchema, updateRatesSchema, updateAvailabilitySchema, updateKycStatusSchema } from '../validators/listener.validator.js';

const router = express.Router();

router.use(authenticate);

// Listeners can access these
router.use(restrictTo('LISTENER', 'CUSTOMER')); // Customer can become a listener by creating a profile

router.get('/profile', listenerController.getProfile);

router.put('/profile', uploadIntroVideo, processAndUploadImage, validate(updateListenerProfileSchema), listenerController.updateProfile);

router.post('/kyc', uploadKYCDocuments, processAndUploadImage, listenerController.submitKyc);

router.put('/rates', restrictTo('LISTENER'), validate(updateRatesSchema), listenerController.updateRates);

router.put('/availability', restrictTo('LISTENER'), validate(updateAvailabilitySchema), listenerController.updateAvailability);

// --- ADMIN ONLY ROUTES ---

router.get('/', restrictTo('ADMIN', 'CUSTOMER'), listenerController.getAllListeners);

router.post('/:id/kyc', restrictTo('ADMIN'), validate(updateKycStatusSchema), listenerController.approveOrRejectListener);

export default router;
