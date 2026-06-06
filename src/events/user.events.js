import { EventEmitter } from 'events';
import logger from '../utils/logger.util.js';

class UserEventEmitter extends EventEmitter {}

const userEvents = new UserEventEmitter();

/**
 * Listeners for user related background events.
 * This ensures the main HTTP thread isn't blocked by slow operations (like emails or FCM pushes).
 */

userEvents.on('userRegistered', async (user) => {
  logger.info(`[Event] Preparing to send welcome email to: ${user.email}`);
  
  try {
    // Await sendEmailService.sendWelcomeEmail(user.email);
    logger.info(`[Event] Welcome email sent to: ${user.email}`);
  } catch (error) {
    logger.error(`[Event Error] Failed to send welcome email to ${user.email}: ${error.message}`);
  }
});

export default userEvents;
