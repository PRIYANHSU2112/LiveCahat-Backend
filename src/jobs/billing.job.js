import cron from 'node-cron';
import billingService from '../services/billing.service.js';
import logger from '../utils/logger.util.js';

/**
 * Background billing cron job initialized on server startup.
 * Runs every 60 seconds (1 minute) to process wallet deductions for active sessions.
 * 
 * @param {Object} io - Socket.io Server instance
 */
export const initializeBillingJob = (io) => {
  cron.schedule('*/1 * * * *', async () => {
    logger.info('[CRON] Running session billing calculation...');
    try {
      await billingService.processBillingCycle(io);
    } catch (error) {
      logger.error(`[CRON Error] Session billing failed: ${error.message}`);
    }
  });

  logger.info('Background billing cron job initialized.');
};
