import express from 'express';
import storyController from '../controllers/story.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadStoryMedia, processAndUploadImage } from '../middlewares/upload.middleware.js';
import {
  createStorySchema,
  uploadUrlSchema,
  feedQuerySchema,
  ownerIdParamSchema,
  storyIdParamSchema,
  batchViewsSchema,
  replyStorySchema,
  updateStorySchema,
} from '../validators/story.validator.js';

const router = express.Router();

// All story routes require authentication
router.use(authenticate);

/**
 * POST /stories
 * Create an active story (IMAGE, VIDEO, or TEXT)
 */
router.post(
  '/',
  uploadStoryMedia,
  processAndUploadImage,
  (req, res, next) => {
    // If multipart sent metadata as JSON string, parse it safely
    if (typeof req.body?.metadata === 'string') {
      try {
        req.body.metadata = JSON.parse(req.body.metadata);
      } catch {
        req.body.metadata = {};
      }
    }
    // If processAndUploadImage set imageUrl or mediaUrl
    if (req.body?.imageUrl && !req.body?.mediaUrl) {
      req.body.mediaUrl = req.body.imageUrl;
    }
    next();
  },
  validate(createStorySchema),
  storyController.createStory
);

/**
 * POST /stories/upload-url
 * Generate authorized presigned PUT upload URL for direct storage upload
 */
router.post('/upload-url', validate(uploadUrlSchema), storyController.getUploadUrl);

/**
 * GET /stories/feed
 * Ranked story bubbles feed with cursor-based pagination
 */
router.get('/feed', validate(feedQuerySchema), storyController.getFeed);

/**
 * GET /stories/user/:ownerId
 * Active stories playback for a specific user
 */
router.get('/user/:ownerId', validate(ownerIdParamSchema), storyController.getOwnerStories);

/**
 * GET /stories/me
 * Logged-in user's own active stories
 */
router.get('/me', storyController.getMyStories);

/**
 * POST /stories/views/batch
 * Batch mark stories as viewed
 */
router.post('/views/batch', validate(batchViewsSchema), storyController.batchRecordViews);

/**
 * POST /stories/:storyId/reply
 * Send a chat message replying to a story
 */
router.post('/:storyId/reply', validate(replyStorySchema), storyController.replyToStory);

/**
 * DELETE /stories/:storyId
 * Delete own story
 */
router.delete('/:storyId', validate(storyIdParamSchema), storyController.deleteStory);

/**
 * PATCH /stories/:storyId
 * Edit own story caption/text
 */
router.patch('/:storyId', validate(updateStorySchema), storyController.updateStory);

export default router;
