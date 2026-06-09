import express from 'express';
import languageController from '../controllers/language.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.use(authenticate);

// Publicly available to authenticated users (e.g. for dropdowns)
router.get('/', languageController.getAllLanguages);
router.get('/:id', languageController.getLanguageById);

// Admin only routes for managing languages
router.use(restrictTo('ADMIN'));

router.post('/', languageController.createLanguage);
router.put('/:id', languageController.updateLanguage);
router.delete('/:id', languageController.deleteLanguage);

export default router;
