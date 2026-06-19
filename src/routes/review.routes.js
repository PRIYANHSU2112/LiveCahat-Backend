import express from 'express';
import reviewController from '../controllers/review.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createOrUpdateReviewSchema,
  listReviewsQuerySchema,
  idParamSchema,
  listenerIdParamSchema,
} from '../validators/review.validator.js';

const router = express.Router();

router.use(authenticate);

// Create or update a review for a listener
router.post(
  '/listeners/:listenerId',
  validate(listenerIdParamSchema),
  validate(createOrUpdateReviewSchema),
  reviewController.createOrUpdateReview
);

// Fetch paginated reviews for a listener
router.get(
  '/listeners/:listenerId',
  validate(listenerIdParamSchema),
  validate(listReviewsQuerySchema),
  reviewController.getListenerReviews
);

// Delete own review
router.delete('/:id', validate(idParamSchema), reviewController.deleteReview);

export default router;
