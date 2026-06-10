import logger from '../utils/logger.util.js';
import config from '../config/index.js';

/**
 * Middleware to calculate response time using high-resolution timers
 * and attach 'X-Response-Time' header to the response.
 * Automatically bypassed in production.
 */
export const responseTimeTracker = (req, res, next) => {
  if (config.env === 'production') {
    logger.info(`Incoming Request: ${req.method} ${req.url}`);
    return next();
  }

  const startHrTime = process.hrtime();
  logger.info(`Incoming Request: ${req.method} ${req.url}`);

  const originalWriteHead = res.writeHead;
  
  res.writeHead = function (...args) {
    const diff = process.hrtime(startHrTime);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    res.setHeader('X-Response-Time', `${durationMs}ms`);
    return originalWriteHead.apply(this, args);
  };

  res.on('finish', () => {
    const diff = process.hrtime(startHrTime);
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    logger.info(`Outgoing Response: ${req.method} ${req.originalUrl} - Status: ${res.statusCode} [${durationMs}ms]`);
  });

  next();
};
