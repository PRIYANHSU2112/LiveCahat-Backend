import express from 'express';
import countryController from '../controllers/country.controller.js';

const router = express.Router();

/**
 * GET /api/v1/countries
 *
 * Public list of active countries (name, ISO code, dial code, flag).
 * Used by the register/login screen to populate the country-code picker.
 */
router.get('/', countryController.getAllCountries);

export default router;
