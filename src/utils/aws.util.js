import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import 'dotenv/config';

// Configure S3 Client for DigitalOcean Spaces / Linode Object Storage
const s3Client = new S3Client({
  endpoint: process.env.LINODE_OBJECT_STORAGE_ENDPOINT,
  region: process.env.LINODE_OBJECT_STORAGE_REGION,
  credentials: {
    accessKeyId: process.env.LINODE_OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.LINODE_OBJECT_STORAGE_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.LINODE_OBJECT_BUCKET;
const FOLDER_PATH = process.env.BUCKET_FOLDER_PATH || '';

/**
 * Uploads a file buffer to S3 compatible storage
 * @param {Buffer} buffer - The file buffer
 * @param {String} originalName - Original file name
 * @param {String} mimetype - File mime type
 * @returns {Promise<String>} - URL of the uploaded file
 */
export const uploadToS3 = async (buffer, originalName, mimetype) => {
  const extension = path.extname(originalName);
  const fileName = `${FOLDER_PATH}${uuidv4()}${extension}`;

  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: mimetype,
    ACL: 'public-read', // Make file publicly accessible
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  // DigitalOcean Spaces URL format: https://[bucket].[region].digitaloceanspaces.com/[key]
  // Extract domain from endpoint
  const endpointUrl = new URL(process.env.LINODE_OBJECT_STORAGE_ENDPOINT);
  const fileUrl = `https://${BUCKET_NAME}.${endpointUrl.hostname}/${fileName}`;
  
  return fileUrl;
};

/**
 * Uploads a file buffer or stream directly using a pre-generated fileName
 */
export const uploadToS3Direct = async (bufferOrStream, fileName, mimetype) => {
  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: bufferOrStream,
    ContentType: mimetype,
    ACL: 'public-read',
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  const endpointUrl = new URL(process.env.LINODE_OBJECT_STORAGE_ENDPOINT);
  const fileUrl = `https://${BUCKET_NAME}.${endpointUrl.hostname}/${fileName}`;
  return fileUrl;
};

/**
 * Deletes a file from S3 compatible storage
 * @param {String} fileUrl - URL of the file to delete
 */
export const deleteFromS3 = async (fileUrl) => {
  if (!fileUrl) return;

  try {
    // Extract key from URL
    const urlParts = new URL(fileUrl);
    const key = urlParts.pathname.substring(1); // Remove leading slash

    const params = {
      Bucket: BUCKET_NAME,
      Key: key,
    };

    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting from S3:', error);
  }
};
