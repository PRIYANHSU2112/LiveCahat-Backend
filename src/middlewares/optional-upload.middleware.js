import { uploadBannerImage, uploadGiftIcon, processAndUploadImage } from './upload.middleware.js';

function runUploadPipeline(uploadMiddleware, req, res, next) {
  uploadMiddleware(req, res, (err) => {
    if (err) return next(err);
    processAndUploadImage(req, res, next);
  });
}

function isMultipart(req) {
  return (req.headers['content-type'] || '').includes('multipart/form-data');
}

/** Apply banner image upload only for multipart requests (JSON bodies stay intact). */
export const optionalBannerImageUpload = (req, res, next) => {
  if (!isMultipart(req)) return next();
  return runUploadPipeline(uploadBannerImage, req, res, next);
};

/** Apply gift icon upload only for multipart requests (JSON bodies stay intact). */
export const optionalGiftIconUpload = (req, res, next) => {
  if (!isMultipart(req)) return next();
  return runUploadPipeline(uploadGiftIcon, req, res, next);
};

/** Apply sticker image upload only for multipart requests (JSON bodies stay intact). */
export const optionalStickerImageUpload = (req, res, next) => {
  if (!isMultipart(req)) return next();
  return runUploadPipeline(uploadBannerImage, req, res, next);
};
