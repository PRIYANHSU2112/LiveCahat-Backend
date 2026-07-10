import express from 'express';
import communicationController from '../controllers/communication.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  adminCommunicationStatsQuerySchema,
  adminCommunicationListQuerySchema,
  adminCommunicationLiveQuerySchema,
  adminCommunicationSessionIdParamSchema,
  updateCommunicationConfigSchema,
} from '../validators/admin-communication.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate, adminOnly);

router.get(
  '/admin/sessions/stats',
  validate(adminCommunicationStatsQuerySchema),
  communicationController.getStats
);
router.get(
  '/admin/sessions/live',
  validate(adminCommunicationLiveQuerySchema),
  communicationController.getLiveSessions
);
router.get(
  '/admin/sessions',
  validate(adminCommunicationListQuerySchema),
  communicationController.listSessions
);
router.get(
  '/admin/sessions/:sessionId',
  validate(adminCommunicationSessionIdParamSchema),
  communicationController.getSessionDetail
);
router.post(
  '/admin/sessions/:sessionId/force-end',
  validate(adminCommunicationSessionIdParamSchema),
  communicationController.forceEndSession
);
router.get('/admin/config', communicationController.getConfig);
router.put(
  '/admin/config',
  validate(updateCommunicationConfigSchema),
  communicationController.updateConfig
);

export default router;
