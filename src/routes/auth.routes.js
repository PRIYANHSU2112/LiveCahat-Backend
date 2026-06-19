import express from 'express';
import authController from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requestOtpSchema, verifyOtpSchema, adminLoginSchema, guestLoginSchema, linkAccountSchema } from '../validators/auth.validator.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/request-otp', validate(requestOtpSchema), authController.requestOtp);
router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyOtp);
router.post('/admin-login', validate(adminLoginSchema), authController.adminLogin);
router.post('/guest-login', validate(guestLoginSchema), authController.guestLogin);
router.post('/link-account', authenticate, validate(linkAccountSchema), authController.linkAccount);

export default router;
