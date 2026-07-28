import cron from 'node-cron';
import billingService from '../services/billing.service.js';
import logger from '../utils/logger.util.js';
import { cronJobDurationSeconds, cronJobExecutionsTotal } from '../observability/metrics.js';

/**
 * Background billing cron job initialized on server startup.
 * Runs every 60 seconds (1 minute) to process wallet deductions for active sessions.
 * 
 * @param {Object} io - Socket.io Server instance
 */
export const initializeBillingJob = (io) => {
  cron.schedule('*/1 * * * *', async () => {
    logger.info('[CRON] Running session billing calculation...');
    const timer = cronJobDurationSeconds.startTimer({ job_name: 'billing_job' });
    try {
      await billingService.processBillingCycle(io);
      timer({ status: 'success' });
      cronJobExecutionsTotal.labels('billing_job', 'success').inc();
    } catch (error) {
      timer({ status: 'error' });
      cronJobExecutionsTotal.labels('billing_job', 'error').inc();
      logger.error(`[CRON Error] Session billing failed: ${error.message}`);
    }
  });

  logger.info('Background billing cron job initialized.');
};

