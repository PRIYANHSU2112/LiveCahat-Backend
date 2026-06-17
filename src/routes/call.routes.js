import express from 'express';
import callController from '../controllers/call.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import callValidator from '../validators/call.validator.js';

const router = express.Router();

// All call routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/calls/initiate
 * Initiate a new audio/video call session and receive an Agora token.
 */
router.post(
  '/initiate',
  validate(callValidator.initiateCall),
  callController.initiateCall
);

/**
 * GET /api/v1/calls/token/:sessionId
 * Fetch or refresh an Agora RTC token for an active session.
 */
router.get(
  '/token/:sessionId',
  validate(callValidator.getToken),
  callController.getToken
);

/**
 * POST /api/v1/calls/end
 * End an active call session via REST API.
 */
router.post(
  '/end',
  validate(callValidator.endCall),
  callController.endCall
);

export default router;
