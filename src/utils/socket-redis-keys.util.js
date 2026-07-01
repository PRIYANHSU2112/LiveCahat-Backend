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

  // ─── Group Live Room ────────────────────────────────────────────────────────

  /** roomId for a host's currently active live room. Value: String roomId */
  liveRoomHost: (hostId) => `live_room:host:${hostId}`,

  /** Set of userIds currently watching a live room. SCARD = viewer count. */
  liveRoomViewers: (roomId) => `live_room:${roomId}:viewers`,

  /** Reverse mapping: which live room a viewer is currently in. Value: String roomId */
  liveRoomViewer: (userId) => `live_room:viewer:${userId}`,

  /** Running like counter (atomic INCR). Value: Integer string. */
  liveRoomLikeCount: (roomId) => `live_room:${roomId}:like_count`,

  /** Recent comments list (LPUSH + LTRIM to 50). Value: JSON strings, newest first. */
  liveRoomComments: (roomId) => `live_room:${roomId}:comments`,

  /** Grace-period key set on host disconnect (30s TTL). Value: String roomId */
  liveRoomDisconnectGrace: (hostId) => `live_room:disconnect_grace:${hostId}`,

  /**
   * Daily peak of concurrently-online listeners for an agent (running max).
   * `dateStr` is YYYY-MM-DD (server local time). Set with a ~48h TTL so the
   * previous day's peak survives for the agent stats "Peak Today" comparison.
   * Value: Integer string.
   */
  agentPeak: (agentId, dateStr) => `agent_peak:${agentId}:${dateStr}`,

  /** Last instant-match listener for a customer (5-min TTL). Value: listenerId */
  matchSticky: (customerId) => `match:sticky:${customerId}`,

  /** Customer paid instant-match fee within sticky window (5-min TTL). Value: "1" */
  matchPaid: (customerId) => `match:paid:${customerId}`,

  /** Cached singleton match config JSON. TTL ~60s */
  matchConfigCache: () => 'match:config',

  /** SET of customerIds who have interacted with a listener (chat/call request or session) */
  listenerInteracted: (listenerId) => `listener:interacted:${listenerId}`,

  /** Reverse index: SET of listenerIds a customer has interacted with */
  customerInteractedListeners: (customerId) => `customer:interacted_listeners:${customerId}`,

  /** Global SET of customer userIds currently online (socket connected) */
  onlineCustomers: () => 'presence:online:customers',
};

export const PATTERNS = {
  allActiveSessions: 'active_session:*',
};
