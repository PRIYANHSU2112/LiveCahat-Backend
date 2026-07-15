import express from 'express';
import matchController from '../controllers/match.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import matchValidator from '../validators/match.validator.js';

const router = express.Router();

router.use(authenticate);

// ─── Admin only (before CUSTOMER restriction) ───────────────────
router.get('/admin/config', restrictTo('ADMIN'), authorize('match.config.read'), matchController.getMatchConfig);
router.put('/admin/config', restrictTo('ADMIN'), authorize('match.config.update'), validate(matchValidator.updateMatchConfig), matchController.updateMatchConfig);

// ─── Customer only ──────────────────────────────────────────────
router.use(restrictTo('CUSTOMER'));

/**
 * GET /api/v1/match/fee
 * Public fee info for the app UI before Find Partner.
 */
router.get('/fee', matchController.getMatchFee);

/**
 * POST /api/v1/match/instant
 * One-click partner match — returns best available ONLINE listener.
 */
router.post('/instant', validate(matchValidator.instantMatch), matchController.instantMatch);

/**
 * GET /api/v1/match/status
 * Quick probe: is any ONLINE partner available (no wallet debit).
 */
router.get('/status', validate(matchValidator.matchStatus), matchController.matchStatus);

/**
 * GET /api/v1/match/discover
 * Discover listeners — rating & anchor level sort, filters, pagination.
 */
router.get('/discover', validate(matchValidator.discoverListeners), matchController.discoverListeners);

export default router;
