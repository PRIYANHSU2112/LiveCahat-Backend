import express from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import listenerRoutes from './listener.routes.js';
import languageRoutes from './language.routes.js';
import coinPackRoutes from './coin-pack.routes.js';
import walletRoutes from './wallet.routes.js';
import followRoutes from './follow.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/listeners', listenerRoutes);
router.use('/languages', languageRoutes);
router.use('/coin-packs', coinPackRoutes);
router.use('/wallets', walletRoutes);
router.use('/follows', followRoutes);

export default router;
