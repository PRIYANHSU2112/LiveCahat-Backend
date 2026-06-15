import express from 'express';
import chatController from '../controllers/chat.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { uploadChatAttachment } from '../middlewares/upload.middleware.js';

const router = express.Router();

// All chat routes require authentication
router.use(authenticate);

// Get all chat sessions for the logged-in user
router.get('/sessions', chatController.getMySessions);

// Get messages for a specific session
router.get('/sessions/:sessionId/messages', chatController.getSessionMessages);

// Send media message (image, video, voice recording)
router.post('/sessions/:sessionId/media', uploadChatAttachment, chatController.sendMediaMessage);

export default router;
