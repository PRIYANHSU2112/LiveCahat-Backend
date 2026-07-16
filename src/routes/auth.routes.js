import express from 'express';
import authController from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requestOtpSchema, verifyOtpSchema, loginSchema, guestLoginSchema, linkAccountSchema } from '../validators/auth.validator.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import {
  checkMaintenanceMode,
  checkRegistrationsAllowed,
} from '../middlewares/maintenance.middleware.js';

const router = express.Router();

router.post(
  '/request-otp',
  checkMaintenanceMode,
  checkRegistrationsAllowed,
  validate(requestOtpSchema),
  authController.requestOtp
);
router.post(
  '/verify-otp',
  checkMaintenanceMode,
  validate(verifyOtpSchema),
  authController.verifyOtp
);

// admin/agent — never blocked by maintenance
router.post('/login', validate(loginSchema), authController.login);
router.post(
  '/guest-login',
  checkMaintenanceMode,
  checkRegistrationsAllowed,
  validate(guestLoginSchema),
  authController.guestLogin
);
router.post('/link-account', authenticate, validate(linkAccountSchema), authController.linkAccount);
router.post('/direct-login', authController.directLogin);

export default router;
