import BaseController from './base.controller.js';
import chatMessageService from '../services/chat-message.service.js';
import catchAsync from '../utils/catchAsync.util.js';
import { uploadToS3 } from '../utils/aws.util.js';
import { getSocketIo } from '../utils/socket.util.js';
import communicationSessionService from '../services/communication-session.service.js';

class ChatController extends BaseController {

  /**
   * GET /chats/conversations
   * WhatsApp/Instagram-style conversation list for the authenticated user.
   */
  getConversations = catchAsync(async (req, res) => {
    const result = await chatMessageService.getConversations(req.user._id, req.query);
    this.sendResponse(res, 200, 'Conversations fetched successfully', result);
  });

  /**
   * GET /chats/sessions
   * List all chat sessions for the authenticated user with last message preview.
   */
  getMySessions = catchAsync(async (req, res) => {
    const result = await chatMessageService.getUserChatSessions(req.user._id, req.query);
    this.sendResponse(res, 200, 'Chat sessions fetched successfully', result);
  });

  /**
   * GET /chats/sessions/:sessionId/messages
   * Get paginated chat history for a specific session.
   */
  getSessionMessages = catchAsync(async (req, res) => {
    const { sessionId } = req.params;

    if (!sessionId) {
      return this.sendError(res, 400, 'Session ID is required');
    }

    const result = await chatMessageService.getSessionMessages(
      sessionId,
      req.user._id,
      req.query
    );
    this.sendResponse(res, 200, 'Chat messages fetched successfully', result);
  });

  /**
   * POST /chats/sessions/:sessionId/media
   * Upload an image, video, or audio file, save it to the DB, and broadcast it via socket.io.
   */
  sendMediaMessage = catchAsync(async (req, res) => {
    const { sessionId } = req.params;
    const senderId = req.user._id;

    if (!sessionId) {
      return this.sendError(res, 400, 'Session ID is required');
    }

    if (!req.file) {
      return this.sendError(res, 400, 'No file uploaded or file format is unsupported');
    }

    // Check if user is in an active session with this ID
    const activeSessionId = await communicationSessionService.getActiveSessionForUser(senderId);
    if (!activeSessionId || activeSessionId !== sessionId) {
      return this.sendError(res, 403, 'You are not in an active session with this ID.');
    }

    // Upload to Linode/DO Spaces S3-compatible storage
    const fileUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);

    // Determine message type and fallback placeholder text based on MIME type
    let messageType = 'TEXT';
    let fallbackText = 'Sent a file';
    if (req.file.mimetype.startsWith('image/')) {
      messageType = 'IMAGE';
      fallbackText = '[Image]';
    } else if (req.file.mimetype.startsWith('video/')) {
      messageType = 'VIDEO';
      fallbackText = '[Video]';
    } else if (req.file.mimetype.startsWith('audio/')) {
      messageType = 'AUDIO';
      fallbackText = '[Voice Message]';
    }

    // Save message with the fileUrl
    const savedMessage = await chatMessageService.saveMessage(
      sessionId,
      senderId,
      fallbackText,
      messageType,
      fileUrl
    );

    // Broadcast message to session room via Socket.io
    const io = getSocketIo();
    if (io) {
      io.to(`session:${sessionId}`).emit('receive_message', {
        senderId: senderId.toString(),
        message: fallbackText,
        messageType,
        fileUrl,
        timestamp: savedMessage.createdAt || new Date(),
      });
    }

    this.sendResponse(res, 201, 'Media message sent successfully', {
      message: savedMessage,
      fileUrl,
    });
  });
}

export default new ChatController();
