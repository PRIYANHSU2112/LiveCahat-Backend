import express from 'express';
import feedbackController from '../controllers/feedback.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createFeedbackSchema,
  updateFeedbackSchema,
  moderateFeedbackSchema,
  listFeedbackQuerySchema,
  adminFeedbackStatsQuerySchema,
  idParamSchema,
} from '../validators/feedback.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.use(authenticate);

// ─── User endpoints (CUSTOMER / LISTENER / ADMIN) ───────────────
router.post('/', validate(createFeedbackSchema), feedbackController.createFeedback);
router.get('/me', validate(listFeedbackQuerySchema), feedbackController.getMyFeedback);

// ─── Admin panel (User Feedback) — before /:id so /admin is not treated as id
router.get(
  '/admin/stats',
  adminOnly,
  authorize('feedback.stats.view'),
  validate(adminFeedbackStatsQuerySchema),
  feedbackController.getAdminStats
);
router.get('/admin', adminOnly, authorize('feedback.read'), validate(listFeedbackQuerySchema), feedbackController.getAllFeedback);
router.patch(
  '/admin/:id/moderate',
  adminOnly,
  authorize('feedback.moderate'),
  validate(idParamSchema),
  validate(moderateFeedbackSchema),
  feedbackController.moderateFeedback
);
router.get('/admin/:id', adminOnly, authorize('feedback.read'), validate(idParamSchema), feedbackController.getFeedbackById);

router.get('/:id', validate(idParamSchema), feedbackController.getFeedbackById);
router.put('/:id', validate(idParamSchema), validate(updateFeedbackSchema), feedbackController.updateFeedback);
router.delete('/:id', validate(idParamSchema), feedbackController.deleteFeedback);

export default router;
