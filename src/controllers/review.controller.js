import BaseController from './base.controller.js';
import reviewService from '../services/review.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class ReviewController extends BaseController {
  // POST /reviews/listeners/:listenerId — create or update a review
  createOrUpdateReview = catchAsync(async (req, res) => {
    const review = await reviewService.createOrUpdateReview(
      req.user._id,
      req.params.listenerId,
      req.body
    );
    this.sendResponse(res, 200, 'Review submitted successfully', review);
  });

  // GET /reviews/listeners/:listenerId — paginated listener reviews
  getListenerReviews = catchAsync(async (req, res) => {
    const data = await reviewService.getListenerReviews(req.params.listenerId, req.query);
    this.sendResponse(res, 200, 'Reviews fetched successfully', data);
  });

  // DELETE /reviews/:id — delete own review
  deleteReview = catchAsync(async (req, res) => {
    await reviewService.deleteReview(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Review deleted successfully');
  });
}

export default new ReviewController();
