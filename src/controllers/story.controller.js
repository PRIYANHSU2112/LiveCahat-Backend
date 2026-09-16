import BaseController from './base.controller.js';
import storyService from '../services/story.service.js';
import storyUploadService from '../services/story-upload.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class StoryController extends BaseController {
  /**
   * POST /stories
   * Create an active story (IMAGE, VIDEO, or TEXT).
   */
  createStory = catchAsync(async (req, res) => {
    const story = await storyService.createStory(req.user._id, req.body);
    this.sendResponse(res, 201, 'Story created successfully', story);
  });

  /**
   * POST /stories/upload-url
   * Generate backend-authorized presigned PUT URL for direct S3/Spaces upload.
   */
  getUploadUrl = catchAsync(async (req, res) => {
    const { fileType, type } = req.body;
    const result = await storyUploadService.generatePresignedUploadUrl(
      req.user._id,
      fileType,
      type
    );
    this.sendResponse(res, 200, 'Upload URL generated successfully', result);
  });

  /**
   * GET /stories/feed
   * Fetch ranked story bubbles feed with cursor pagination.
   */
  getFeed = catchAsync(async (req, res) => {
    const result = await storyService.getStoryFeed(req.user._id, req.query);
    this.sendResponse(res, 200, 'Story feed fetched successfully', result);
  });

  /**
   * GET /stories/user/:ownerId
   * Fetch playback stories for a specific owner.
   */
  getOwnerStories = catchAsync(async (req, res) => {
    const { ownerId } = req.params;
    const result = await storyService.getOwnerStories(ownerId, req.user._id);
    this.sendResponse(res, 200, 'Owner stories fetched successfully', result);
  });

  /**
   * GET /stories/me
   * Fetch caller's own active stories with view counts.
   */
  getMyStories = catchAsync(async (req, res) => {
    const result = await storyService.getMyStories(req.user._id);
    this.sendResponse(res, 200, 'My stories fetched successfully', result);
  });

  /**
   * POST /stories/views/batch
   * Batch record story views (non-blocking, updates 24h rolling Redis cache).
   */
  batchRecordViews = catchAsync(async (req, res) => {
    const { storyIds } = req.body;
    const result = await storyService.batchRecordViews(req.user._id, storyIds);
    this.sendResponse(res, 200, 'Story views recorded successfully', result);
  });

  /**
   * POST /stories/:storyId/reply
   * Send a chat message replying to a story, embedding lean storyContext.
   */
  replyToStory = catchAsync(async (req, res) => {
    const { storyId } = req.params;
    const { text } = req.body;
    const message = await storyService.replyToStory(req.user._id, storyId, text);
    this.sendResponse(res, 201, 'Story reply sent successfully', message);
  });

  /**
   * DELETE /stories/:storyId
   * Soft-delete a story owned by the user and reconcile active caches.
   */
  deleteStory = catchAsync(async (req, res) => {
    const { storyId } = req.params;
    const result = await storyService.deleteStory(storyId, req.user._id);
    this.sendResponse(res, 200, 'Story deleted successfully', result);
  });
}

export default new StoryController();
