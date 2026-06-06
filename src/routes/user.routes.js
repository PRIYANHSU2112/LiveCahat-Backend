import { Router } from 'express';
import userController from '../controllers/user.controller.js';

const router = Router();

// Route mappings
router.post('/register', userController.createUser);
router.get('/:id', userController.getUser);

export default router;
