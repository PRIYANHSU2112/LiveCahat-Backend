/**
 * Socket.io Event Constants
 * Single source of truth for client-to-server and server-to-client socket events.
 */

export const CLIENT_EVENTS = {
  REQUEST_CHAT: 'request_chat',
  ACCEPT_CHAT: 'accept_chat',
  REJECT_CHAT: 'reject_chat',
  CANCEL_CHAT: 'cancel_chat',
  JOIN_SESSION: 'join_session',
  SEND_MESSAGE: 'send_message',
  TYPING: 'typing',
  END_CHAT: 'end_chat',

  // ─── Call (Audio / Video) ─────────────────────────────────────
  REQUEST_CALL: 'request_call',
  ACCEPT_CALL: 'accept_call',
  REJECT_CALL: 'reject_call',
  CANCEL_CALL: 'cancel_call',
  END_CALL: 'end_call',

  // ─── WhatsApp-Style Direct Messaging ──────────────────────────
  /** Direct message (conversation-based, no active session required) */
  CHAT_SEND_MESSAGE: 'chat:send_message',
  /** Receiver ACKs delivery of offline-queued messages */
  CHAT_ACK_DELIVERED: 'chat:ack_delivered',
  /** User marks a conversation as read up to a specific messageId */
  CHAT_READ_CONVERSATION: 'chat:read_conversation',
  /** Direct typing indicator (conversation-based) */
  CHAT_TYPING: 'chat:typing',

  // ─── Group Live Room ──────────────────────────────────────────
  LIVE_START: 'live:start',
  LIVE_END: 'live:end',
  LIVE_JOIN: 'live:join',
  LIVE_LEAVE: 'live:leave',
  LIVE_COMMENT: 'live:comment',
  LIVE_LIKE: 'live:like',
};

export const SERVER_EVENTS = {
  INCOMING_CHAT_REQUEST: 'incoming_chat_request',
  CHAT_REQUEST_ACCEPTED: 'chat_request_accepted',
  CHAT_REQUEST_REJECTED: 'chat_request_rejected',
  CHAT_STARTED: 'chat_started',
  CHAT_ENDED: 'chat_ended',
  RECEIVE_MESSAGE: 'receive_message',
  MESSAGE_DELETED: 'message_deleted',
  DISPLAY_TYPING: 'display_typing',
  LISTENER_STATUS_CHANGED: 'listener_status_changed',
  BALANCE_WARNING: 'balance_warning',
  ERROR: 'socket_error',

  // ─── Presence / Connection ──────────────────────────────────────
  LISTENER_ONLINE: 'listener_online',
  LISTENER_OFFLINE: 'listener_offline',
  USER_PRESENCE_CHANGED: 'user_presence_changed',
  USER_RECONNECTED: 'user_reconnected',
  USER_JOINED: 'user_joined',

  // ─── Listener Home ──────────────────────────────────────────────
  LISTENER_HOME_PRESENCE: 'listener_home_presence',
  LISTENER_HOME_INTERACTION: 'listener_home_interaction',

  // ─── Call (Audio / Video) ─────────────────────────────────────
  INCOMING_CALL_REQUEST: 'incoming_call_request',
  CALL_REQUEST_ACCEPTED: 'call_request_accepted',
  CALL_REQUEST_REJECTED: 'call_request_rejected',
  CALL_STARTED: 'call_started',
  CALL_ENDED: 'call_ended',

  // ─── WhatsApp-Style Direct Messaging ──────────────────────────
  /** Server ACK to sender: message accepted and dispatched (✓ single tick) */
  CHAT_ACK_SENT: 'chat:ack_sent',
  /** Incoming direct message to receiver */
  CHAT_RECEIVE_MESSAGE: 'chat:receive_message',
  /** Offline messages batch delivered on reconnect */
  CHAT_OFFLINE_MESSAGES: 'chat:offline_messages',
  /** Sender notified: message delivered to receiver (✓✓ double tick) */
  CHAT_MESSAGE_DELIVERED: 'chat:message_delivered',
  /** Sender notified: receiver read conversation up to messageId (✓✓ blue) */
  CHAT_MESSAGES_READ: 'chat:messages_read',
  /** Wallet insufficient for message cost */
  CHAT_INSUFFICIENT_BALANCE: 'chat:insufficient_balance',
  /** Direct typing indicator to receiver */
  CHAT_DISPLAY_TYPING: 'chat:display_typing',
  /** Chat session paused due to inactivity */
  CHAT_PAUSED: 'chat:paused',

  // ─── Group Live Room ──────────────────────────────────────────
  LIVE_STARTED: 'live:started',
  LIVE_ENDED: 'live:ended',
  LIVE_VIEWER_JOINED: 'live:viewer_joined',
  LIVE_VIEWER_LEFT: 'live:viewer_left',
  LIVE_VIEWER_COUNT_UPDATE: 'live:viewer_count_update',
  LIVE_NEW_COMMENT: 'live:new_comment',
  LIVE_LIKE_UPDATE: 'live:like_update',
  // ─── Agent Dashboard ─────────────────────────────────────────────
  AGENT_DASHBOARD_LIVE: 'agent:dashboard:live',
  AGENT_ACTIVITY: 'agent:activity',
};
