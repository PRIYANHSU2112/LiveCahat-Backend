import express from 'express';
import communicationController from '../controllers/communication.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
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
  authorize('communication.session.read'),
  validate(adminCommunicationStatsQuerySchema),
  communicationController.getStats
);
router.get(
  '/admin/sessions/live',
  authorize('communication.session.read'),
  validate(adminCommunicationLiveQuerySchema),
  communicationController.getLiveSessions
);
router.get(
  '/admin/sessions',
  authorize('communication.session.read'),
  validate(adminCommunicationListQuerySchema),
  communicationController.listSessions
);
router.get(
  '/admin/sessions/:sessionId',
  authorize('communication.session.read'),
  validate(adminCommunicationSessionIdParamSchema),
  communicationController.getSessionDetail
);
router.post(
  '/admin/sessions/:sessionId/force-end',
  authorize('communication.session.force_end'),
  validate(adminCommunicationSessionIdParamSchema),
  communicationController.forceEndSession
);
router.get('/admin/config', authorize('communication.config.read'), communicationController.getConfig);
router.put(
  '/admin/config',
  authorize('communication.config.update'),
  validate(updateCommunicationConfigSchema),
  communicationController.updateConfig
);

export default router;
