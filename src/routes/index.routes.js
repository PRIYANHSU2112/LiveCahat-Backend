import express from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import listenerRoutes from './listener.routes.js';
import languageRoutes from './language.routes.js';
import coinPackRoutes from './coin-pack.routes.js';
import paymentRoutes from './payment.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/listeners', listenerRoutes);
router.use('/languages', languageRoutes);
router.use('/coin-packs', coinPackRoutes);
router.use('/payments', paymentRoutes);

export default router;
