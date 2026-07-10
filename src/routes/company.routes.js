import express from 'express';
import companyController from '../controllers/company.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import { createCompanySchema, updateCompanySchema } from '../validators/company.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.get('/profile', companyController.getCompanyProfile);

router.use(authenticate);

router.get('/admin/profile', adminOnly, companyController.getAdminProfile);
router.get('/admin/stats', adminOnly, companyController.getAdminStats);
router.put('/admin/profile', adminOnly, validate(updateCompanySchema), companyController.upsertAdminProfile);

router.get('/', adminOnly, companyController.getAllCompanies);
router.get('/:id', adminOnly, requireObjectId('id'), companyController.getCompanyById);

router.use(adminOnly);

router.post('/', validate(createCompanySchema), companyController.createCompany);
router.put('/:id', requireObjectId('id'), validate(updateCompanySchema), companyController.updateCompany);
router.delete('/:id', requireObjectId('id'), companyController.deleteCompany);

export default router;
