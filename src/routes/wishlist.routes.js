import express from 'express';
import wishlistController from '../controllers/wishlist.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { listenerIdParamSchema, paginationSchema } from '../validators/wishlist.validator.js';

const router = express.Router();

// Authenticate all routes
router.use(authenticate);

// Add listener to wishlist (Customer only)
router.post('/:listenerId', restrictTo('CUSTOMER'), validate(listenerIdParamSchema), wishlistController.addToWishlist);

// Remove listener from wishlist (Customer only)
router.delete('/:listenerId', restrictTo('CUSTOMER'), validate(listenerIdParamSchema), wishlistController.removeFromWishlist);

// Get my wishlisted listeners list
router.get('/', validate(paginationSchema), wishlistController.getWishlist);

// Check if a specific listener is in my wishlist
router.get('/status/:listenerId', validate(listenerIdParamSchema), wishlistController.checkStatus);

export default router;
