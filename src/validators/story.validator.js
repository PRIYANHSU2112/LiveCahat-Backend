import Joi from 'joi';

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export const createStorySchema = Joi.object({
  body: Joi.object({
    type: Joi.string().valid('IMAGE', 'VIDEO', 'TEXT').default('IMAGE'),
    fileKey: Joi.string().trim().optional().allow(null, ''),
    mediaUrl: Joi.string().allow(null, '').optional(),
    uploadToken: Joi.string().trim().optional().allow(null, ''),
    thumbnailUrl: Joi.string().allow(null, '').optional(),
    caption: Joi.string().trim().max(500).allow('', null).optional(),
    text: Joi.string().trim().max(1000).when('type', {
      is: 'TEXT',
      then: Joi.required(),
      otherwise: Joi.optional().allow('', null),
    }),
    visibility: Joi.string().valid('PUBLIC', 'FOLLOWERS').default('PUBLIC'),
    metadata: Joi.object({
      width: Joi.number().min(0).max(4096).optional().allow(null),
      height: Joi.number().min(0).max(4096).optional().allow(null),
      duration: Joi.number().min(0).max(300).optional().allow(null),
      backgroundColor: Joi.string().max(30).optional().allow(null, ''),
      textColor: Joi.string().max(30).optional().allow(null, ''),
      fontFamily: Joi.string().max(50).optional().allow(null, ''),
    }).optional().default({}),
  }),
});

export const uploadUrlSchema = Joi.object({
  body: Joi.object({
    fileType: Joi.string()
      .valid('image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')
      .required()
      .messages({
        'any.only': 'fileType must be one of image/jpeg, image/png, image/webp, video/mp4, video/quicktime',
      }),
    fileSize: Joi.number().max(52428800).optional(), // 50MB
    type: Joi.string().valid('IMAGE', 'VIDEO').required(),
  }),
});

export const feedQuerySchema = Joi.object({
  query: Joi.object({
    cursor: Joi.string().allow('', null).optional(),
    limit: Joi.number().integer().min(1).max(50).default(20),
  }),
});

export const ownerIdParamSchema = Joi.object({
  params: Joi.object({
    ownerId: Joi.string()
      .regex(objectIdPattern)
      .required()
      .messages({ 'string.pattern.base': 'ownerId must be a valid 24-character hex ObjectId' }),
  }),
});

export const storyIdParamSchema = Joi.object({
  params: Joi.object({
    storyId: Joi.string()
      .regex(objectIdPattern)
      .required()
      .messages({ 'string.pattern.base': 'storyId must be a valid 24-character hex ObjectId' }),
  }),
});

export const batchViewsSchema = Joi.object({
  body: Joi.object({
    storyIds: Joi.array()
      .items(
        Joi.string()
          .regex(objectIdPattern)
          .messages({ 'string.pattern.base': 'Each storyId must be a valid 24-character hex ObjectId' })
      )
      .min(1)
      .max(100)
      .required()
      .messages({
        'array.min': 'At least one storyId is required in storyIds array',
        'array.max': 'Cannot batch more than 100 storyIds per request',
      }),
  }),
});

export const replyStorySchema = Joi.object({
  params: Joi.object({
    storyId: Joi.string()
      .regex(objectIdPattern)
      .required()
      .messages({ 'string.pattern.base': 'storyId must be a valid 24-character hex ObjectId' }),
  }),
  body: Joi.object({
    text: Joi.string().trim().min(1).max(500).required().messages({
      'string.empty': 'Reply text is required',
      'string.max': 'Reply text cannot exceed 500 characters',
    }),
  }),
});

export const updateStorySchema = Joi.object({
  params: Joi.object({
    storyId: Joi.string()
      .regex(objectIdPattern)
      .required()
      .messages({ 'string.pattern.base': 'storyId must be a valid 24-character hex ObjectId' }),
  }),
  body: Joi.object({
    caption: Joi.string().trim().max(500).allow('', null).optional(),
    text: Joi.string().trim().max(1000).allow('', null).optional(),
  }),
});

