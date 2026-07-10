import express from 'express';
import countryController from '../controllers/country.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createCountrySchema,
  updateCountrySchema,
  listCountryQuerySchema,
  idParamSchema,
} from '../validators/country.validator.js';

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

router.get('/admin/stats', adminOnly, countryController.getAdminStats);
router.get('/admin', adminOnly, validate(listCountryQuerySchema), countryController.getAdminCountries);

router.post('/', adminOnly, validate(createCountrySchema), countryController.createCountry);

router.get(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  countryController.getCountryById,
);
router.put(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  validate(updateCountrySchema),
  countryController.updateCountry,
);
router.patch(
  '/:id/toggle',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  countryController.toggleCountry,
);
router.delete(
  '/:id',
  adminOnly,
  requireObjectId('id'),
  validate(idParamSchema),
  countryController.deleteCountry,
);

export default router;
