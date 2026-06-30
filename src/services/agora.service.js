import pkg from 'agora-token';
const { RtcTokenBuilder, RtcRole } = pkg;
import config from '../config/index.js';
import logger from '../utils/logger.util.js';

const HEX_32 = /^[0-9a-fA-F]{32}$/;

/**
 * AgoraService – Secure Agora RTC Token Generation.
 *
 * Encapsulates all Agora credential access. No other module should
 * import `agora-token` directly or reference the App Certificate.
 */
class AgoraService {
  #isValidCredential(value) {
    return typeof value === 'string' && HEX_32.test(value);
  }

  /**
   * Generate a secure Agora RTC token for a given channel and user.
   *
   * @param {string}  channelName   - Channel name (derived from session ID).
   * @param {number}  uid           - Deterministic user UID (unsigned 32-bit integer).
   * @param {string}  [role='PUBLISHER'] - 'PUBLISHER' for both audio & video senders,
   *                                       'SUBSCRIBER' for receive-only participants (future use).
   * @param {number}  [expirySeconds=3600] - Token lifetime in seconds.
   * @returns {string|null} Signed Agora RTC token, or null when App Certificate is not configured.
   * @throws {Error}  If Agora credentials are missing or token build fails.
   */
  generateRtcToken(channelName, uid, role = 'PUBLISHER', expirySeconds = 3600) {
    const appId = (config.agora.appId || '').trim();
    const appCertificate = (config.agora.appCertificate || '').trim();
    const authMode = config.agora.authMode || 'secured';

    if (!appId) {
      if (config.env === 'development' || config.env === 'test' || !config.env) {
        logger.warn(`[Agora Service] Agora App ID is not configured. Returning a mock token for development/testing (channel=${channelName}, uid=${uid}).`);
        return `mock_token_for_channel_${channelName}_uid_${uid}`;
      }
      throw new Error('Agora App ID is not configured. Check AGORA_APP_ID env var.');
    }

    if (!this.#isValidCredential(appId)) {
      throw new Error('AGORA_APP_ID must be a 32-character hex string from the Agora Console.');
    }

    // Agora "Testing" projects have App Certificate disabled — join with token=null
    if (authMode === 'testing') {
      logger.info(`[Agora Service] Testing mode (token=null). channel=${channelName}, uid=${uid}`);
      return null;
    }

    if (!appCertificate) {
      throw new Error(
        'AGORA_APP_CERTIFICATE is required for secured mode. Copy Primary Certificate from the same Agora project as AGORA_APP_ID, or set AGORA_AUTH_MODE=testing.'
      );
    }

    if (!this.#isValidCredential(appCertificate)) {
      throw new Error('AGORA_APP_CERTIFICATE must be the 32-character Primary Certificate from the Agora Console.');
    }

    try {
      let token;

      // agora-token v2 expects relative seconds from now, not Unix timestamps
      if (role === 'PUBLISHER') {
        token = RtcTokenBuilder.buildTokenWithUidAndPrivilege(
          appId,
          appCertificate,
          channelName,
          uid,
          expirySeconds,
          expirySeconds,
          expirySeconds,
          expirySeconds,
          expirySeconds
        );
      } else {
        token = RtcTokenBuilder.buildTokenWithUid(
          appId,
          appCertificate,
          channelName,
          uid,
          RtcRole.SUBSCRIBER,
          expirySeconds,
          expirySeconds
        );
      }

      if (!token) {
        throw new Error('Agora token builder returned an empty token. Verify AGORA_APP_ID and AGORA_APP_CERTIFICATE match the same Agora project.');
      }

      logger.info(`[Agora Service] Token generated for channel=${channelName}, uid=${uid}, role=${role}, expires in ${expirySeconds}s`);
      return token;
    } catch (err) {
      logger.error(`[Agora Service] Token generation failed: ${err.message}`);
      throw err;
    }
  }
}

export default new AgoraService();
