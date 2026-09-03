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
   * Set of online customer userIds
   */
  onlineCustomers: () => 'presence:customers:online',

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
   * Chat request payload (expires via RING_REQUEST_TTL_SEC)
   * Value: JSON { type:'CHAT', callerId, listenerId, callerInfo, chatRate }
   */
  chatRequest: (listenerId, callerId) => `chat_request:${listenerId}:${callerId}`,

  /**
   * Call ring request — separate from chat so they never overwrite each other
   * Value: JSON { type:'CALL', callerId, listenerId, mode, ratePerMinute, callerInfo }
   */
  callRequest: (listenerId, callerId) => `call_request:${listenerId}:${callerId}`,

  /**
   * Unique call request by callRequestId (UUID)
   */
  callRequestById: (callRequestId) => `call_request:${callRequestId}`,

  /**
   * Distributed atomic lock for user during ringing (prevents double-ringing / concurrency collision)
   */
  callLock: (userId) => `lock:call:${userId}`,

  /**
   * User active ring pointer (mapping userId to active callRequestId)
   */
  userActiveCallRing: (userId) => `call_ring_active:${userId}`,

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

  /** Running like counter (atomic INCR/DECR or SCARD). Value: Integer string. */
  liveRoomLikeCount: (roomId) => `live_room:${roomId}:like_count`,

  /** Set of userIds who liked the room for toggle like support (SCARD / SISMEMBER). */
  liveRoomLikers: (roomId) => `live_room:${roomId}:likers`,

  /** Recent comments list (LPUSH + LTRIM to 50). Value: JSON strings, newest first. */
  liveRoomComments: (roomId) => `live_room:${roomId}:comments`,

  /** Unpersisted comment buffer for bulk MongoDB persistence (Redis LIST). */
  liveRoomCommentBuffer: (roomId) => `live_room:${roomId}:comment_buffer`,

  /** Running total comments counter. Value: Integer string. */
  liveRoomTotalComments: (roomId) => `live_room:${roomId}:total_comments`,

  /** Peak concurrent viewer counter. Value: Integer string. */
  liveRoomPeakViewers: (roomId) => `live_room:${roomId}:peak_viewers`,

  /** Grace-period key set on host disconnect (30s TTL). Value: String roomId */
  liveRoomDisconnectGrace: (hostId) => `live_room:disconnect_grace:${hostId}`,

  /** Recent agent dashboard activity feed (Redis LIST). */
  agentActivity: (agentId) => `agent:activity:${agentId}`,

  /** Debounce key for live dashboard socket updates per agent. */
  agentLiveDebounce: (agentId) => `agent:live:debounce:${agentId}`,

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

  // ─── Live Room Billing ─────────────────────────────────────────────────────

  /**
   * Hash: per-viewer billing state in a live room.
   * Fields: joinedAt, lastBilledAt, coinsCharged, liveRate, earningPercent, hostId
   */
  liveRoomViewerBilling: (roomId, userId) => `live_billing:${roomId}:${userId}`,

  /** SET of roomIds with at least one actively-billed viewer. Used by cron scan. */
  liveRoomBillingSet: () => 'live_billing:active_rooms',

  // ─── WhatsApp-Style Chat Messaging ─────────────────────────────────────────

  /** Idempotency guard for a client-generated message UUID. Value: 'PROCESSED'. TTL: 24h. */
  msgIdempotency: (clientMsgId) => `msg:idempotency:${clientMsgId}`,

  /** Customer's cached wallet balance in Redis for atomic Lua debit. Value: Integer string. */
  walletBalance: (userId) => `wallet:user:${userId}:balance`,

  /** Redis Stream: offline message mailbox for a receiver. Entries: { clientMsgId, payload }. */
  chatMailboxStream: (receiverId) => `chat:mailbox:stream:${receiverId}`,

  /** Hash: per-sender unread message counts for a user. Field: senderId → count. */
  unreadUser: (userId) => `unread:user:${userId}`,

  /** Monotonic read pointer for a conversation. Value: lastReadMessageId string. */
  convRead: (userId, partnerId) => `conv:read:${userId}:${partnerId}`,

  /** Monotonic read timestamp for a conversation. Value: ISO timestamp string. */
  convReadTs: (userId, partnerId) => `conv:read:ts:${userId}:${partnerId}`,
};

export const PATTERNS = {
  allActiveSessions: 'active_session:*',
  /** Pattern to find all viewer billing hashes for a given room. */
  liveRoomBillingViewers: (roomId) => `live_billing:${roomId}:*`,
  /** Pattern to find all offline mailbox streams. */
  allChatMailboxStreams: 'chat:mailbox:stream:*',
};
