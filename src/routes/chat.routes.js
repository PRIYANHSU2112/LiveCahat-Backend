import express from 'express';
import chatController from '../controllers/chat.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { uploadChatAttachment } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { conversationListQuerySchema, sessionIdParamSchema } from '../validators/chat.validator.js';

const router = express.Router();

// All chat routes require authentication
router.use(authenticate);

/**
 * GET /chats/conversations
 * Inbox list: partners, last message, unread count, search, pagination.
 */
router.get('/conversations', validate(conversationListQuerySchema), chatController.getConversations);

// Get all chat sessions for the logged-in user
router.get('/sessions', chatController.getMySessions);

// Get messages for a specific session
router.get('/sessions/:sessionId/messages', chatController.getSessionMessages);

// Soft-delete a single message (own messages only)
router.delete(
  '/sessions/:sessionId/messages/:messageId',
  chatController.deleteMessage,
);

// Mark all incoming messages in a session as read
router.patch('/sessions/:sessionId/read', chatController.markAsRead);

// Send media message (image, video, voice recording)
router.post('/sessions/:sessionId/media', uploadChatAttachment, chatController.sendMediaMessage);

/**
 * GET /chats/direct/:partnerId/messages
 * Direct WhatsApp-style conversation messages without sessionId.
 */
router.get('/direct/:partnerId/messages', chatController.getDirectMessages);

export default router;
