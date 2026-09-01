import cron from 'node-cron';
import billingService from '../services/billing.service.js';
import liveBillingService from '../services/live-billing.service.js';
import logger from '../utils/logger.util.js';
import { cronJobDurationSeconds, cronJobExecutionsTotal } from '../observability/metrics.js';

/**
 * Background billing cron job initialized on server startup.
 * Runs every 60 seconds (1 minute) to process wallet deductions for:
 *  1. Active 1-on-1 communication sessions (chat/audio/video)
 *  2. Active live room viewers (per-minute viewer billing)
 * 
 * @param {Object} io - Socket.io Server instance
 */
export const initializeBillingJob = (io) => {
  cron.schedule('*/1 * * * *', async () => {
    logger.info('[CRON] Running session billing calculation...');
    const timer = cronJobDurationSeconds.startTimer({ job_name: 'billing_job' });
    try {
      await billingService.processBillingCycle(io);
      cronJobExecutionsTotal.labels('billing_job', 'success').inc();
    } catch (error) {
      cronJobExecutionsTotal.labels('billing_job', 'error').inc();
      logger.error(`[CRON Error] Session billing failed: ${error.message}`);
    }

    // Live room viewer billing (independent try/catch)
    try {
      await liveBillingService.processLiveBillingCycle();
    } catch (error) {
      logger.error(`[CRON Error] Live room billing failed: ${error.message}`);
    }

    timer({ status: 'success' });
  });

  logger.info('Background billing cron job initialized.');
};
