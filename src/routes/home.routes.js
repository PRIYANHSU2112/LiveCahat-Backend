import express from 'express';
import homeController from '../controllers/home.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { homeListenersQuerySchema } from '../validators/listener.validator.js';

const router = express.Router();

// Home screen is for logged-in app users (customers can browse, listeners too).
router.use(authenticate);
router.use(restrictTo('CUSTOMER', 'LISTENER'));

/**
 * GET /api/v1/home/user-home
 *
 * User home feed — active (KYC-approved, non-blocked, non-deleted) listeners.
 *
 * Query Parameters (all optional):
 *   q         - Name keyword (firstName / lastName / full name)
 *   language  - Language ObjectId, name, or code (e.g. "Hindi", "HI")
 *   country   - User countryCode (e.g. "IN", "US")
 *   status    - Availability: ONLINE | OFFLINE | BUSY
 *   minRating - Minimum average rating (0–5)
 *   sort      - featured (default) | popular | rating | newest
 *   page      - Page number (default: 1)
 *   limit     - Results per page (default: 10, max: 50)
 */
router.get('/user-home', validate(homeListenersQuerySchema), homeController.getHomeListeners);

export default router;
