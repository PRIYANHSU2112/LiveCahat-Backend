import pkg from 'agora-token';
const { RtcTokenBuilder, RtcRole } = pkg;
import config from '../config/index.js';
import logger from '../utils/logger.util.js';

/**
 * AgoraService – Secure Agora RTC Token Generation.
 *
 * Encapsulates all Agora credential access. No other module should
 * import `agora-token` directly or reference the App Certificate.
 */
class AgoraService {
  /**
   * Generate a secure Agora RTC token for a given channel and user.
   *
   * @param {string}  channelName   - Channel name (derived from session ID).
   * @param {number}  uid           - Deterministic user UID (unsigned 32-bit integer).
   * @param {string}  [role='PUBLISHER'] - 'PUBLISHER' for both audio & video senders,
   *                                       'SUBSCRIBER' for receive-only participants (future use).
   * @param {number}  [expirySeconds=3600] - Token lifetime in seconds.
   * @returns {string} Signed Agora RTC token.
   * @throws {Error}  If Agora credentials are missing or token build fails.
   */
  generateRtcToken(channelName, uid, role = 'PUBLISHER', expirySeconds = 3600) {
    const { appId, appCertificate } = config.agora;

    if (!appId) {
      if (config.env === 'development' || config.env === 'test' || !config.env) {
        logger.warn(`[Agora Service] Agora App ID is not configured. Returning a mock token for development/testing (channel=${channelName}, uid=${uid}).`);
        return `mock_token_for_channel_${channelName}_uid_${uid}`;
      }
      throw new Error('Agora App ID is not configured. Check AGORA_APP_ID env var.');
    }

    if (!appCertificate) {
      if (config.env === 'development' || config.env === 'test' || !config.env) {
        logger.warn(`[Agora Service] Agora App Certificate is not configured. Returning empty string to enable App ID-only (no token) authentication mode. channel=${channelName}, uid=${uid}`);
        return '';
      }
      throw new Error('Agora App Certificate is not configured. Check AGORA_APP_CERTIFICATE env var.');
    }

    const agoraRole = role === 'PUBLISHER' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirySeconds;

    try {
      const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        uid,
        agoraRole,
        privilegeExpiredTs,  // Token expiry
        privilegeExpiredTs   // Privilege expiry
      );

      logger.info(`[Agora Service] Token generated for channel=${channelName}, uid=${uid}, role=${role}, expires in ${expirySeconds}s`);
      return token;
    } catch (err) {
      logger.error(`[Agora Service] Token generation failed: ${err.message}`);
      throw err;
    }
  }
}

export default new AgoraService();
