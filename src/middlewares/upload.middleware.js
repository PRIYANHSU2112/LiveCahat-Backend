import multer from 'multer';
import sharp from 'sharp';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.util.js';
import { uploadToS3 } from '../utils/aws.util.js';

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Not an image! Please upload only JPG, JPEG, PNG or WEBP.'), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit
  },
});

export const uploadUserPhoto = upload.single('profileImage');
export const uploadKYCDocuments = upload.fields([
  { name: 'documentFront', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 },
  { name: 'selfieImage', maxCount: 1 }
]);

export const processAndUploadImage = catchAsync(async (req, res, next) => {
  if (!req.file && !req.files) return next();

  const processImage = async (file) => {
    const buffer = await sharp(file.buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .toFormat('webp')
      .webp({ quality: 80 })
      .toBuffer();
    
    // Upload compressed image to S3 (DigitalOcean Spaces)
    const fileUrl = await uploadToS3(buffer, file.originalname.replace(/\.[^/.]+$/, "") + ".webp", 'image/webp');
    return fileUrl;
  };

  // Handle single file (profile image)
  if (req.file) {
    req.body.profileImage = await processImage(req.file);
  }

  // Handle multiple files (KYC documents)
  if (req.files) {
    const uploadTasks = [];

    if (req.files.documentFront) {
      uploadTasks.push(processImage(req.files.documentFront[0]).then(url => req.body.documentFront = url));
    }
    if (req.files.documentBack) {
      uploadTasks.push(processImage(req.files.documentBack[0]).then(url => req.body.documentBack = url));
    }
    if (req.files.selfieImage) {
      uploadTasks.push(processImage(req.files.selfieImage[0]).then(url => req.body.selfieImage = url));
    }

    await Promise.all(uploadTasks);
  }

  next();
});
