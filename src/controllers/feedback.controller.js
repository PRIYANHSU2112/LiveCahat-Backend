import BaseController from './base.controller.js';
import feedbackService from '../services/feedback.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class FeedbackController extends BaseController {
  // POST /feedback — submit feedback (any authenticated role)
  createFeedback = catchAsync(async (req, res) => {
    const feedback = await feedbackService.createFeedback(req.user, req.body);
    this.sendResponse(res, 201, 'Feedback submitted successfully', feedback);
  });

  // GET /feedback/me — my feedback (paginated)
  getMyFeedback = catchAsync(async (req, res) => {
    const data = await feedbackService.getMyFeedback(req.user._id, req.query);
    this.sendResponse(res, 200, 'Feedback fetched successfully', data);
  });

  // GET /feedback/:id — owner or admin
  getFeedbackById = catchAsync(async (req, res) => {
    const data = await feedbackService.getFeedbackById(req.params.id, req.user);
    this.sendResponse(res, 200, 'Feedback fetched successfully', data);
  });

  // PUT /feedback/:id — owner edit (while OPEN)
  updateFeedback = catchAsync(async (req, res) => {
    const data = await feedbackService.updateFeedback(req.params.id, req.user, req.body);
    this.sendResponse(res, 200, 'Feedback updated successfully', data);
  });

  // DELETE /feedback/:id — owner or admin
  deleteFeedback = catchAsync(async (req, res) => {
    await feedbackService.deleteFeedback(req.params.id, req.user);
    this.sendResponse(res, 200, 'Feedback deleted successfully');
  });

  // ─── Admin ──────────────────────────────────────────────────────

  // GET /feedback — list all (filters + pagination)
  getAllFeedback = catchAsync(async (req, res) => {
    const data = await feedbackService.getAllFeedback(req.query);
    this.sendResponse(res, 200, 'Feedback list fetched successfully', data);
  });

  // PATCH /feedback/:id/moderate — set status / respond
  moderateFeedback = catchAsync(async (req, res) => {
    const data = await feedbackService.moderateFeedback(req.params.id, req.user, req.body);
    this.sendResponse(res, 200, 'Feedback moderated successfully', data);
  });
}

export default new FeedbackController();
