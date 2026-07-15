import express from 'express';
import followController from '../controllers/follow.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  listenerIdParamSchema,
  userIdParamSchema,
  paginationSchema,
  followersListSchema,
  topFollowedSchema,
} from '../validators/follow.validator.js';

const router = express.Router();

// ─── All routes require authentication ──────────────────────────
router.use(authenticate);

// ─── USER ROUTES (CUSTOMER) ─────────────────────────────────────

// Follow a listener
router.post('/:listenerId', restrictTo('CUSTOMER'), validate(listenerIdParamSchema), followController.follow);

// Unfollow a listener
router.delete('/:listenerId', restrictTo('CUSTOMER'), validate(listenerIdParamSchema), followController.unfollow);

// Get my following list
router.get('/following', validate(paginationSchema), followController.getFollowing);

// Get my favourites list
router.get('/favorites', validate(paginationSchema), followController.getFavorites);

// Get followers of a specific listener
router.get('/followers/:listenerId', validate(followersListSchema), followController.getFollowers);

// Get follow counts for any user
router.get('/counts/:userId', validate(userIdParamSchema), followController.getFollowCounts);

// Check if I follow a specific listener
router.get('/status/:listenerId', validate(listenerIdParamSchema), followController.checkStatus);

// Toggle favourite on a followed listener
router.patch('/favorite/:listenerId', restrictTo('CUSTOMER'), validate(listenerIdParamSchema), followController.toggleFavorite);

// ─── ADMIN ROUTES ───────────────────────────────────────────────

// Top followed listeners (analytics)
router.get('/top', restrictTo('ADMIN'), authorize('follow.analytics.view'), validate(topFollowedSchema), followController.getTopFollowed);

export default router;
