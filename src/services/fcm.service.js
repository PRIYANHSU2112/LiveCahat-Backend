import { getMessaging } from '../config/firebase.js';
import logger from '../utils/logger.util.js';

class FcmService {
  /**
   * Sanitizes payload data object to ensure all values are strings (FCM requirement)
   */
  _formatData(data = {}) {
    const formatted = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        formatted[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    }
    return formatted;
  }

  /**
   * Send push notification to a single FCM device token
   * @param {string} token - FCM registration token
   * @param {object} payload - { title, body, imageUrl, data }
   */
  async sendToToken(token, { title, body, imageUrl, data = {} }) {
    if (!token) {
      return { success: false, error: 'No FCM token provided' };
    }

    const messaging = getMessaging();
    if (!messaging) {
      logger.warn('[FCM] Firebase Messaging not initialized');
      return { success: false, error: 'Firebase messaging not initialized' };
    }

    try {
      const message = {
        token,
        notification: {
          title,
          body,
          ...(imageUrl ? { imageUrl } : {}),
        },
        data: this._formatData({
          ...data,
          title: title || '',
          body: body || '',
        }),
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: 'max',
            ...(data?.channelId ? { channelId: data.channelId } : {}),
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      const response = await messaging.send(message);
      logger.info(`[FCM] Push notification sent to Firebase (Message ID: ${response})`);
      return { success: true, messageId: response };
    } catch (error) {
      logger.error(`[FCM] Failed to send push notification: ${error.message}`);
      return { success: false, error: error.message, code: error.code };
    }
  }

  /**
   * Send push notification to multiple FCM device tokens (multicast)
   * @param {string[]} tokens - Array of FCM registration tokens
   * @param {object} payload - { title, body, imageUrl, data }
   */
  async sendMulticast(tokens, { title, body, imageUrl, data = {} }) {
    const validTokens = (tokens || []).filter((t) => typeof t === 'string' && t.trim().length > 0);

    if (validTokens.length === 0) {
      return { successCount: 0, failureCount: 0, responses: [] };
    }

    const messaging = getMessaging();
    if (!messaging) {
      logger.warn('[FCM] Firebase Messaging not initialized');
      return { successCount: 0, failureCount: validTokens.length, error: 'Firebase messaging not initialized' };
    }

    try {
      const message = {
        tokens: validTokens,
        notification: {
          title,
          body,
          ...(imageUrl ? { imageUrl } : {}),
        },
        data: this._formatData({
          ...data,
          title: title || '',
          body: body || '',
        }),
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: 'max',
            ...(data?.channelId ? { channelId: data.channelId } : {}),
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      const response = await messaging.sendEachForMulticast(message);
      logger.info(`[FCM] Multicast notification sent to Firebase (Success: ${response.successCount}, Failure: ${response.failureCount})`);
      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses,
      };
    } catch (error) {
      logger.error(`[FCM] Multicast error: ${error.message}`);
      return {
        successCount: 0,
        failureCount: validTokens.length,
        error: error.message,
      };
    }
  }

  /**
   * Send push notification to a topic
   * @param {string} topic - Topic name (e.g. 'all_users', 'listeners')
   * @param {object} payload - { title, body, imageUrl, data }
   */
  async sendToTopic(topic, { title, body, imageUrl, data = {} }) {
    if (!topic) {
      return { success: false, error: 'Topic is required' };
    }

    const messaging = getMessaging();
    if (!messaging) {
      return { success: false, error: 'Firebase messaging not initialized' };
    }

    try {
      const message = {
        topic,
        notification: {
          title,
          body,
          ...(imageUrl ? { imageUrl } : {}),
        },
        data: this._formatData(data),
      };

      const response = await messaging.send(message);
      logger.info(`[FCM] Topic notification sent to Firebase (Topic: "${topic}", Message ID: ${response})`);
      return { success: true, messageId: response };
    } catch (error) {
      logger.error(`[FCM] Topic error ("${topic}"): ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

export default new FcmService();
