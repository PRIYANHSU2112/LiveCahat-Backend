import express from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import listenerRoutes from './listener.routes.js';
import languageRoutes from './language.routes.js';
import coinPackRoutes from './coin-pack.routes.js';
import walletRoutes from './wallet.routes.js';
import followRoutes from './follow.routes.js';
import companyRoutes from './company.routes.js';
import giftRoutes from './gift.routes.js';
import chatRoutes from './chat.routes.js';
import bannerRoutes from './banner.routes.js';
import wishlistRoutes from './wishlist.routes.js';
import dailyRewardRoutes from './daily-reward.routes.js';
import avatarRoutes from './avatar.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/listeners', listenerRoutes);
router.use('/languages', languageRoutes);
router.use('/coin-packs', coinPackRoutes);
router.use('/wallets', walletRoutes);
router.use('/follows', followRoutes);
router.use('/company', companyRoutes);
router.use('/gifts', giftRoutes);
router.use('/chats', chatRoutes);
router.use('/banners', bannerRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/daily-rewards', dailyRewardRoutes);
router.use('/avatars', avatarRoutes);

export default router;

