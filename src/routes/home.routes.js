import express from 'express';
import homeController from '../controllers/home.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { homeListenersQuerySchema } from '../validators/listener.validator.js';
import { listenerHomeQuerySchema } from '../validators/home.validator.js';

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/v1/home/user-home
 *
 * User home feed — active (KYC-approved, non-blocked, non-deleted) listeners.
 */
router.get(
  '/user-home',
  restrictTo('CUSTOMER', 'LISTENER'),
  validate(homeListenersQuerySchema),
  homeController.getHomeListeners
);

/**
 * GET /api/v1/home/listener-home
 *
 * Listener home feed — online, new, and popular customers for the logged-in listener.
 *
 * Query Parameters (all optional):
 *   section      - online | new | popular (omit for all three)
 *   onlinePage   - Online users page (default: 1)
 *   onlineLimit  - Online users per page (default: 10, max: 50)
 *   newPage        - New users page (default: 1)
 *   newLimit       - New users per page (default: 10, max: 50)
 *   popularPage    - Popular users page (default: 1)
 *   popularLimit   - Popular users per page (default: 10, max: 50)
 */
router.get(
  '/listener-home',
  restrictTo('LISTENER'),
  validate(listenerHomeQuerySchema),
  homeController.getListenerHome
);

export default router;
