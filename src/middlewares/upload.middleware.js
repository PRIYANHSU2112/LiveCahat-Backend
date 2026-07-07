import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.util.js';
import { queueImageCompression, queueVideoCompression } from '../utils/background-job.util.js';

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Unsupported file format! Please upload only JPG, JPEG, PNG, WEBP images or MP4, MOV, WebM videos.'), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit to support video uploads
  },
});

export const uploadUserPhoto = upload.single('profileImage');
export const uploadIntroVideo = upload.single('introVideo');
export const uploadBannerImage = upload.single('image');
export const uploadGiftIcon = upload.single('icon');

export const uploadKYCDocuments = upload.fields([
  { name: 'documentFront', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'selfieImage', maxCount: 1 }
]);

/**
 * Middleware to process media uploads asynchronously in the background.
 * Predicts and assigns S3 URLs instantly, offloading compression/upload to background event loop.
 */
export const processAndUploadImage = catchAsync(async (req, res, next) => {
  if (!req.file && !req.files) return next();

  const handleMedia = (file) => {
    const isVideo = file.mimetype.startsWith('video/');
    const ext = isVideo ? path.extname(file.originalname) : '.webp';
    const fileName = `${process.env.BUCKET_FOLDER_PATH || ''}${uuidv4()}${ext}`;
    
    const endpoint = process.env.LINODE_OBJECT_STORAGE_ENDPOINT;
    const bucket = process.env.LINODE_OBJECT_BUCKET;
    if (!endpoint || !bucket) {
      throw new ApiError(500, 'File storage is not configured. Please provide an image URL instead.');
    }

    const endpointUrl = new URL(endpoint);
    const fileUrl = `https://${bucket}.${endpointUrl.hostname}/${fileName}`;

    if (isVideo) {
      queueVideoCompression(file.buffer, fileName, file.mimetype);
    } else {
      queueImageCompression(file.buffer, fileName, file.mimetype);
    }
    
    return fileUrl;
  };

  // Handle single file (profile image or video)
  if (req.file) {
    if (req.file.fieldname === 'introVideo') {
      req.body.introVideo = handleMedia(req.file);
    } else if (req.file.fieldname === 'image') {
      const fileUrl = handleMedia(req.file);
      req.body.imageUrl = fileUrl;
      req.body.image = fileUrl;
    } else if (req.file.fieldname === 'icon') {
      const fileUrl = handleMedia(req.file);
      req.body.iconUrl = fileUrl;
      req.body.icon = fileUrl;
    } else {
      req.body.profileImage = handleMedia(req.file);
    }
  }

  // Handle multiple files (KYC documents)
  if (req.files) {
    const fields = ['documentFront', 'documentBack', 'selfieImage'];
    fields.forEach(field => {
      if (req.files[field]) {
        req.body[field] = handleMedia(req.files[field][0]);
      }
    });
  }

  next();
});

const chatMulterFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/mp4'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Unsupported file format! Please upload only JPG, JPEG, PNG, WEBP images, MP4, MOV, WebM videos, or audio recordings.'), false);
  }
};

export const uploadChatAttachment = multer({
  storage: multerStorage,
  fileFilter: chatMulterFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
}).single('file');
