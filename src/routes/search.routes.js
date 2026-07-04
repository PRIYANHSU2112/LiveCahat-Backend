import express from 'express';
import searchController from '../controllers/search.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { agentSearchQuerySchema } from '../validators/search.validator.js';

const router = express.Router();

// All search routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/search/listeners
 *
 * User-facing listener search.
 * Any authenticated user (CUSTOMER, LISTENER, ADMIN) can use this.
 *
 * Query Parameters:
 *   q           - Keyword to search by name (firstName or lastName)
 *   country     - Country code filter  (e.g. "IN", "US")
 *   language    - Language ObjectId, name, or code  (e.g. "Hindi", "HI", "<id>")
 *   category    - Listener category  (e.g. "Friendly Talk", "Motivation")
 *   availability- ONLINE | OFFLINE | BUSY
 *   page        - Page number (default: 1)
 *   limit       - Results per page (default: 10)
 *   sortBy      - Field to sort by (default: createdAt)
 *   sortOrder   - asc | desc (default: desc)
 *
 * Example:
 *   GET /api/v1/search/listeners?q=john&country=IN&language=Hindi&availability=ONLINE
 */
router.get('/listeners', searchController.searchListeners);

/**
 * GET /api/v1/search/agent/listeners
 *
 * Agent-facing lightweight listener search for top-bar autocomplete.
 * Scoped to listeners owned by the authenticated agent (createdByAgentId).
 *
 * Query Parameters:
 *   q             - Keyword: name, username, email, mobile (min 2 chars)
 *   country       - Country ObjectId, ISO code, or name
 *   accountStatus - active | blocked | pending
 *   kycStatus     - PENDING | UNDER_REVIEW | APPROVED | REJECTED
 *   liveStatus    - ONLINE | OFFLINE | BUSY
 *   page          - Page number (default: 1)
 *   limit         - Results per page (default: 10, max: 20)
 *
 * At least one filter (q, country, accountStatus, kycStatus, liveStatus) is required.
 *
 * Example:
 *   GET /api/v1/search/agent/listeners?q=john&country=India&accountStatus=active
 */
router.get(
  '/agent/listeners',
  restrictTo('AGENT'),
  validate(agentSearchQuerySchema),
  searchController.searchAgentListeners
);

/**
 * GET /api/v1/search/admin
 *
 * Admin-facing global search across all Users and Listener Profiles.
 * ADMIN role only.
 *
 * Query Parameters (all optional):
 *   q           - Keyword: searches name, email, mobile number
 *   type        - CUSTOMER | LISTENER | ADMIN | AGENT
 *   country     - Country code (e.g. "IN", "US")
 *   language    - Language ObjectId, name, or code
 *   gender      - MALE | FEMALE | OTHER
 *   isBlocked   - true | false
 *   isDeleted   - true | false
 *   dateFrom    - ISO date string for createdAt >= filter
 *   dateTo      - ISO date string for createdAt <= filter
 *
 *   --- Listener-specific filters (only applies when user has a listener profile) ---
 *   kycStatus   - PENDING | UNDER_REVIEW | APPROVED | REJECTED
 *   availability- ONLINE | OFFLINE | BUSY
 *   category    - Listener category
 *   minEarnings - Minimum totalEarnings on listener profile
 *   maxEarnings - Maximum totalEarnings on listener profile
 *   minRating   - Minimum avgRating on listener profile
 *
 *   --- Pagination & Sorting ---
 *   page        - Page number (default: 1)
 *   limit       - Results per page (default: 10)
 *   sortBy      - Field to sort by (default: createdAt)
 *   sortOrder   - asc | desc (default: desc)
 *
 * Example:
 *   GET /api/v1/search/admin?q=alice&type=LISTENER&kycStatus=APPROVED&minRating=4&isBlocked=false
 */
router.get('/admin', restrictTo('ADMIN'), searchController.adminGlobalSearch);

export default router;
