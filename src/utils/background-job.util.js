import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { uploadToS3Direct } from './aws.util.js';
import logger from './logger.util.js';

// Ensure temp storage directory exists
const tempDir = path.resolve('src/storage/temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Queue an image compression and upload in the background
 */
export const queueImageCompression = (fileBuffer, fileName, mimetype) => {
  // Execute asynchronously in the event loop
  (async () => {
    try {
      logger.info(`[Background Job] Starting image compression for ${fileName}`);
      
      const compressedBuffer = await sharp(fileBuffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .toFormat('webp')
        .webp({ quality: 80 })
        .toBuffer();

      await uploadToS3Direct(compressedBuffer, fileName, 'image/webp');
      logger.info(`[Background Job] Successfully uploaded compressed image: ${fileName}`);
    } catch (error) {
      logger.error(`[Background Job] Image compression failed for ${fileName}:`, error);
      
      // Fallback: Upload original image if compression fails
      try {
        await uploadToS3Direct(fileBuffer, fileName, mimetype);
        logger.warn(`[Background Job] Uploaded original uncompressed image as fallback: ${fileName}`);
      } catch (fallbackError) {
        logger.error(`[Background Job] Fallback upload also failed for ${fileName}:`, fallbackError);
      }
    }
  })();
};

/**
 * Queue a video compression and upload in the background
 */
export const queueVideoCompression = (fileBuffer, fileName, mimetype) => {
  (async () => {
    const tempInputPath = path.join(tempDir, `input_${uuidv4()}_${path.basename(fileName)}`);
    const tempOutputPath = path.join(tempDir, `output_${uuidv4()}_${path.basename(fileName)}`);

    try {
      logger.info(`[Background Job] Writing video buffer to temp file: ${tempInputPath}`);
      fs.writeFileSync(tempInputPath, fileBuffer);

      logger.info(`[Background Job] Starting video compression using ffmpeg for ${fileName}`);

      // Compress video using H.264 codec, CRF 28 (good quality/size balance)
      const command = `ffmpeg -y -i "${tempInputPath}" -vcodec libx264 -crf 28 -preset fast -acodec aac -b:a 128k "${tempOutputPath}"`;

      exec(command, async (error, stdout, stderr) => {
        try {
          if (error) {
            logger.warn(`[Background Job] ffmpeg error (likely not installed). Uploading original video. Details: ${error.message}`);
            // Clean up input
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
            
            // Upload original
            await uploadToS3Direct(fileBuffer, fileName, mimetype);
            logger.info(`[Background Job] Successfully uploaded original video as fallback: ${fileName}`);
            return;
          }

          logger.info(`[Background Job] Video compression finished. Reading output buffer: ${tempOutputPath}`);
          const compressedBuffer = fs.readFileSync(tempOutputPath);

          // Upload compressed video
          await uploadToS3Direct(compressedBuffer, fileName, mimetype);
          logger.info(`[Background Job] Successfully uploaded compressed video: ${fileName}`);

          // Clean up temp files
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        } catch (innerError) {
          logger.error(`[Background Job] S3 upload failed for video ${fileName}:`, innerError);
          // Cleanup
          if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        }
      });

    } catch (error) {
      logger.error(`[Background Job] Video compression job error for ${fileName}:`, error);
      
      // Cleanup
      if (fs.existsSync(tempInputPath)) {
        try { fs.unlinkSync(tempInputPath); } catch (e) {}
      }
      if (fs.existsSync(tempOutputPath)) {
        try { fs.unlinkSync(tempOutputPath); } catch (e) {}
      }

      // Fallback upload
      try {
        await uploadToS3Direct(fileBuffer, fileName, mimetype);
        logger.warn(`[Background Job] Uploaded original video as fallback due to processing crash: ${fileName}`);
      } catch (fallbackError) {
        logger.error(`[Background Job] Fallback video upload failed:`, fallbackError);
      }
    }
  })();
};
