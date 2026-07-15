import express from 'express';
import companyController from '../controllers/company.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import { createCompanySchema, updateCompanySchema } from '../validators/company.validator.js';

const router = express.Router();
const adminOnly = restrictTo('ADMIN');

router.get('/profile', companyController.getCompanyProfile);

router.use(authenticate);

router.get('/admin/profile', adminOnly, authorize('company.read'), companyController.getAdminProfile);
router.get('/admin/stats', adminOnly, authorize('company.stats.view'), companyController.getAdminStats);
router.put('/admin/profile', adminOnly, authorize('company.update'), validate(updateCompanySchema), companyController.upsertAdminProfile);

router.get('/', adminOnly, authorize('company.read'), companyController.getAllCompanies);
router.get('/:id', adminOnly, authorize('company.read'), requireObjectId('id'), companyController.getCompanyById);

router.use(adminOnly);

router.post('/', authorize('company.create'), validate(createCompanySchema), companyController.createCompany);
router.put('/:id', authorize('company.update'), requireObjectId('id'), validate(updateCompanySchema), companyController.updateCompany);
router.delete('/:id', authorize('company.delete'), requireObjectId('id'), companyController.deleteCompany);

export default router;
