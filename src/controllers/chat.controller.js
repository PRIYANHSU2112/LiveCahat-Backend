import BaseController from './base.controller.js';
import chatMessageService from '../services/chat-message.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class ChatController extends BaseController {

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
}

export default new ChatController();
