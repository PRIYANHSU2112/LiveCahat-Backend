import express from 'express';
import countryController from '../controllers/country.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createCountrySchema,
  updateCountrySchema,
  listCountryQuerySchema,
  idParamSchema,
} from '../validators/country.validator.js';
import adminExportController from '../controllers/admin-export.controller.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

/**
 * GET /api/v1/countries
 *
 * Public list of active countries (name, ISO code, dial code, flag).
 * Used by the register/login screen to populate the country-code picker.
 */
router.get('/', countryController.getAllCountries);

router.use(authenticate);

router.get('/admin/stats', adminOnly, authorize('country.stats.view'), countryController.getAdminStats);
router.get('/admin/export', adminOnly, authorize('country.read'), validate(listCountryQuerySchema), adminExportController.exportCountries);
router.get('/admin', adminOnly, authorize('country.read'), validate(listCountryQuerySchema), countryController.getAdminCountries);

router.post('/', adminOnly, authorize('country.create'), validate(createCountrySchema), countryController.createCountry);

router.get(
  '/:id',
  adminOnly,
  authorize('country.read'),
  requireObjectId('id'),
  validate(idParamSchema),
  countryController.getCountryById,
);
router.put(
  '/:id',
  adminOnly,
  authorize('country.update'),
  requireObjectId('id'),
  validate(idParamSchema),
  validate(updateCountrySchema),
  countryController.updateCountry,
);
router.patch(
  '/:id/toggle',
  adminOnly,
  authorize('country.update'),
  requireObjectId('id'),
  validate(idParamSchema),
  countryController.toggleCountry,
);
router.delete(
  '/:id',
  adminOnly,
  authorize('country.delete'),
  requireObjectId('id'),
  validate(idParamSchema),
  countryController.deleteCountry,
);

export default router;
