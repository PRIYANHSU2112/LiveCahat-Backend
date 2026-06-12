import express from 'express';
import companyController from '../controllers/company.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { createCompanySchema, updateCompanySchema } from '../validators/company.validator.js';

const router = express.Router();

// Publicly fetch the primary company profile (logos, social links, website, policies etc.)
router.get('/profile', companyController.getCompanyProfile);

// Authenticated routes
router.use(authenticate);

// List/Retrieve company records by ID
router.get('/', companyController.getAllCompanies);
router.get('/:id', companyController.getCompanyById);

// Admin-only management routes
router.use(restrictTo('ADMIN'));

router.post('/', validate(createCompanySchema), companyController.createCompany);
router.put('/:id', validate(updateCompanySchema), companyController.updateCompany);
router.delete('/:id', companyController.deleteCompany);

export default router;
