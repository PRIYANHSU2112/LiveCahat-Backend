import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';

// S3 Configuration
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

// Memory storage for Multer (File buffer kept in RAM before streaming to S3)
const multerStorage = multer.memoryStorage();

export const upload = multer({
  storage: multerStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Example upload function
export const uploadToS3 = async (fileBuffer, fileName, mimeType) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: `uploads/${Date.now()}_${fileName}`,
    Body: fileBuffer,
    ContentType: mimeType,
  };

  await s3.send(new PutObjectCommand(params));
  return `https://${params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${params.Key}`;
};
