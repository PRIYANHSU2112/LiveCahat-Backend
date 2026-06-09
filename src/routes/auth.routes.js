import express from 'express';
import authController from '../controllers/auth.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requestOtpSchema, verifyOtpSchema, adminLoginSchema } from '../validators/auth.validator.js';

const router = express.Router();

router.post('/request-otp', validate(requestOtpSchema), authController.requestOtp);

router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyOtp);

router.post('/admin-login', validate(adminLoginSchema), authController.adminLogin);

export default router;
