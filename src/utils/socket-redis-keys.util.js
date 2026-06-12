/**
 * Redis Key Helpers for Socket & Real-time Session Management.
 * Avoids hardcoded strings across files.
 */

export const KEYS = {
  /**
   * Set containing socket IDs connected for this user (supports multi-device)
   * Value: Set of socket IDs
   */
  presenceConnections: (userId) => `presence:connections:${userId}`,

  /**
   * User presence status: ONLINE, BUSY, OFFLINE
   * Value: String status
   */
  presenceStatus: (userId) => `presence:status:${userId}`,

  /**
   * Details of an active communication session
   * Value: Hash { callerId, listenerId, ratePerMinute, startTime, lastBilledAt, segmentId, mode }
   */
  activeSession: (sessionId) => `active_session:${sessionId}`,

  /**
   * Mapping of user ID to active session ID
   * Value: String sessionId
   */
  userSession: (userId) => `user_session:${userId}`,

  /**
   * Chat request payload stored under listenerId & callerId (expires in 30s)
   * Value: JSON { callerId, listenerId, callerInfo, chatRate }
   */
  chatRequest: (listenerId, callerId) => `chat_request:${listenerId}:${callerId}`,

  /**
   * Redis key indicating that a user recently disconnected and is in their reconnection grace period
   * Value: String sessionId
   */
  disconnectGrace: (userId) => `disconnect_grace:${userId}`,
};

export const PATTERNS = {
  allActiveSessions: 'active_session:*',
};
