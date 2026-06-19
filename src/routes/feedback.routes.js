import express from 'express';
import feedbackController from '../controllers/feedback.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createFeedbackSchema,
  updateFeedbackSchema,
  moderateFeedbackSchema,
  listFeedbackQuerySchema,
  idParamSchema,
} from '../validators/feedback.validator.js';

const router = express.Router();

router.use(authenticate);

// ─── Any authenticated user (CUSTOMER / LISTENER / ADMIN) ────────
router.post('/', validate(createFeedbackSchema), feedbackController.createFeedback);
router.get('/me', validate(listFeedbackQuerySchema), feedbackController.getMyFeedback);
router.get('/:id', validate(idParamSchema), feedbackController.getFeedbackById);
router.put('/:id', validate(idParamSchema), validate(updateFeedbackSchema), feedbackController.updateFeedback);
router.delete('/:id', validate(idParamSchema), feedbackController.deleteFeedback);

// ─── Admin only ─────────────────────────────────────────────────
router.use(restrictTo('ADMIN'));
router.get('/', validate(listFeedbackQuerySchema), feedbackController.getAllFeedback);
router.patch('/:id/moderate', validate(idParamSchema), validate(moderateFeedbackSchema), feedbackController.moderateFeedback);

export default router;
