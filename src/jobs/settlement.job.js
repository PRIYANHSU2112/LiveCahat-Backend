import cron from 'node-cron';
import agentSettlementService from '../services/agent-settlement.service.js';
import logger from '../utils/logger.util.js';
import User from '../modules/user.model.js';
import { cronJobDurationSeconds, cronJobExecutionsTotal } from '../observability/metrics.js';

/**
 * Background settlement cron job initialized on server startup.
 * Runs every Monday at 00:00 (midnight) to settle the previous week's commission for all agents.
 */
export const initializeSettlementJob = () => {
  // '0 0 * * 1' means every Monday at 00:00
  cron.schedule('0 0 * * 1', async () => {
    logger.info('[CRON] Running weekly agent settlements...');
    const timer = cronJobDurationSeconds.startTimer({ job_name: 'settlement_job' });
    try {
      // We pass null for adminId since it's an automated system job
      const systemAdmin = await User.findOne({ type: 'ADMIN' }).select('_id').lean();
      const adminId = systemAdmin ? systemAdmin._id : null;
      
      const result = await agentSettlementService.runSettlements(adminId, { weeksAgo: 1 });
      timer({ status: 'success' });
      cronJobExecutionsTotal.labels('settlement_job', 'success').inc();
      logger.info(`[CRON] Weekly agent settlements completed. Processed ${result.processed} agents.`);
    } catch (error) {
      timer({ status: 'error' });
      cronJobExecutionsTotal.labels('settlement_job', 'error').inc();
      logger.error(`[CRON Error] Weekly agent settlements failed: ${error.message}`);
    }
  });

  logger.info('Background settlement cron job initialized.');
};

