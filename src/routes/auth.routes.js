import express from 'express';
import authController from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requestOtpSchema, verifyOtpSchema, loginSchema, guestLoginSchema, linkAccountSchema } from '../validators/auth.validator.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/request-otp', validate(requestOtpSchema), authController.requestOtp);
router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyOtp);

// admin/agent
router.post('/login', validate(loginSchema), authController.login);
router.post('/guest-login', validate(guestLoginSchema), authController.guestLogin);
router.post('/link-account', authenticate, validate(linkAccountSchema), authController.linkAccount);
router.post('/direct-login', authController.directLogin);

export default router;
