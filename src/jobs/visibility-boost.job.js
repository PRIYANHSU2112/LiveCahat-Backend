import cron from 'node-cron';
import visibilityBoostService from '../services/visibility-boost.service.js';
import logger from '../utils/logger.util.js';

/**
 * Background Visibility Boost Sweeper Job.
 * Runs every 2 minutes to mark expired boosts as EXPIRED in the database
 * and invalidate the home feed cache.
 */

export const initializeVisibilityBoostJob = () => {
  cron.schedule('*/5 * * * *', async () => {
    try {
      await visibilityBoostService.expireStaleBoosts();
    } catch (error) {
      logger.error(`[VisibilityBoost Job Error] Failed to expire boosts: ${error.message}`);
    }
  });

  logger.info('Background visibility boost expiry job initialized.');
};
