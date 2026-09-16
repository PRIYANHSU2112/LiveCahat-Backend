import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.util.js';

// Allowed MIME types and max sizes
const ALLOWED_MIME_TYPES = {
  'image/jpeg': { ext: '.jpg', type: 'IMAGE', maxSize: 10 * 1024 * 1024 }, // 10 MB
  'image/jpg': { ext: '.jpg', type: 'IMAGE', maxSize: 10 * 1024 * 1024 },
  'image/png': { ext: '.png', type: 'IMAGE', maxSize: 10 * 1024 * 1024 },
  'image/webp': { ext: '.webp', type: 'IMAGE', maxSize: 10 * 1024 * 1024 },
  'video/mp4': { ext: '.mp4', type: 'VIDEO', maxSize: 50 * 1024 * 1024 }, // 50 MB
  'video/quicktime': { ext: '.mov', type: 'VIDEO', maxSize: 50 * 1024 * 1024 },
};

const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

class StoryUploadService {
  constructor() {
    this.endpoint = process.env.LINODE_OBJECT_STORAGE_ENDPOINT || 'https://sgp1.digitaloceanspaces.com';
    this.region = process.env.LINODE_OBJECT_STORAGE_REGION || 'sgp1';
    this.bucket = process.env.LINODE_OBJECT_BUCKET || 'satyakabir-bucket';
    this.folder = process.env.BUCKET_FOLDER_PATH || 'LiveChat/';

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region: this.region,
      credentials: {
        accessKeyId: process.env.LINODE_OBJECT_STORAGE_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.LINODE_OBJECT_STORAGE_SECRET_ACCESS_KEY || '',
      },
    });
  }

  /**
   * Authorize and generate a presigned PUT upload URL for direct mobile-to-cloud upload.
   *
   * @param {string} userId - Requesting user ID
   * @param {string} fileType - Client MIME type (e.g. 'image/jpeg')
   * @param {string} storyType - 'IMAGE' or 'VIDEO'
   * @returns {Promise<{ uploadUrl: string, fileKey: string, uploadToken: string, cdnUrl: string, expiresIn: number }>}
   */
  async generatePresignedUploadUrl(userId, fileType, storyType) {
    const normalizedMime = (fileType || '').toLowerCase().trim();
    const config = ALLOWED_MIME_TYPES[normalizedMime];

    if (!config) {
      throw new ApiError(
        400,
        `Unsupported media type: ${fileType}. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`
      );
    }

    if (storyType && storyType !== config.type) {
      throw new ApiError(400, `MIME type ${fileType} does not match requested story type ${storyType}`);
    }

    const uniqueId = uuidv4();
    const fileKey = `${this.folder}stories/${userId}/${uniqueId}${config.ext}`;
    const uploadToken = uuidv4();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
      ContentType: normalizedMime,
      ACL: 'public-read',
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });

    // Store single-use authorization token in Redis (TTL: 30 minutes)
    if (redisClient.isRedisAvailable) {
      const authPayload = {
        userId: userId.toString(),
        fileType: normalizedMime,
        type: config.type,
        maxSize: config.maxSize,
        uploadToken,
        createdAt: Date.now(),
      };
      await redisClient.set(
        KEYS.storyUploadAuth(fileKey),
        JSON.stringify(authPayload),
        'EX',
        PRESIGNED_URL_EXPIRY_SECONDS * 2
      );
    }

    const endpointUrl = new URL(this.endpoint);
    const cdnUrl = `https://${this.bucket}.${endpointUrl.hostname}/${fileKey}`;

    logger.info(`[StoryUpload] Issued presigned URL for user ${userId}, key: ${fileKey}`);

    return {
      uploadUrl,
      fileKey,
      uploadToken,
      cdnUrl,
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    };
  }

  /**
   * Verify an uploaded object directly against object storage via HeadObject.
   * Ensures the file actually exists, was uploaded by this user, and matches size/type bounds.
   *
   * @param {string} userId - Authenticated user ID
   * @param {string} fileKey - Backend-issued S3 fileKey
   * @param {string} [uploadToken] - Token issued during upload authorization
   * @returns {Promise<{ mediaUrl: string, fileKey: string, contentType: string, contentLength: number }>}
   */
  async verifyUploadedMedia(userId, fileKey, uploadToken) {
    if (!fileKey || typeof fileKey !== 'string') {
      throw new ApiError(400, 'fileKey is required for media stories');
    }

    // 1. Verify fileKey belongs to this user namespace
    const userPathPrefix = `${this.folder}stories/${userId.toString()}/`;
    if (!fileKey.startsWith(userPathPrefix)) {
      throw new ApiError(403, 'Unauthorized fileKey: Does not match your user directory');
    }

    // 2. Verify authorization token from Redis if available
    if (redisClient.isRedisAvailable) {
      const authKey = KEYS.storyUploadAuth(fileKey);
      const rawAuth = await redisClient.get(authKey);

      if (rawAuth) {
        try {
          const authData = JSON.parse(rawAuth);
          if (authData.userId !== userId.toString()) {
            throw new ApiError(403, 'Unauthorized: Upload token was issued to a different user');
          }
          if (uploadToken && authData.uploadToken !== uploadToken) {
            throw new ApiError(400, 'Invalid upload token for this fileKey');
          }
        } catch (parseErr) {
          if (parseErr instanceof ApiError) throw parseErr;
        }
      }
    }

    // 3. Direct HeadObject verification against S3 / DigitalOcean Spaces
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: fileKey,
      });

      const headResult = await this.s3Client.send(headCommand);

      const contentLength = headResult.ContentLength || 0;
      const contentType = (headResult.ContentType || '').toLowerCase().trim();

      if (contentLength <= 0) {
        throw new ApiError(400, 'Uploaded file is empty (0 bytes)');
      }

      const mimeConfig = ALLOWED_MIME_TYPES[contentType];
      if (!mimeConfig) {
        throw new ApiError(400, `Uploaded object has unsupported Content-Type: ${contentType}`);
      }

      if (contentLength > mimeConfig.maxSize) {
        throw new ApiError(
          400,
          `Uploaded file exceeds maximum limit of ${mimeConfig.maxSize / (1024 * 1024)}MB`
        );
      }

      // Single-use token cleanup
      if (redisClient.isRedisAvailable) {
        await redisClient.del(KEYS.storyUploadAuth(fileKey));
      }

      const endpointUrl = new URL(this.endpoint);
      const mediaUrl = `https://${this.bucket}.${endpointUrl.hostname}/${fileKey}`;

      logger.info(`[StoryUpload] Verified media key ${fileKey} (${contentLength} bytes, ${contentType})`);

      return {
        mediaUrl,
        fileKey,
        contentType,
        contentLength,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        throw new ApiError(400, 'Media file was not found in storage. Please upload the file first.');
      }
      logger.error(`[StoryUpload] HeadObject failed for ${fileKey}: ${err.message}`);
      throw new ApiError(500, `Storage verification failed: ${err.message}`);
    }
  }
}

export default new StoryUploadService();
