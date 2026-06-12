/**
 * Socket.io Event Constants
 * Single source of truth for client-to-server and server-to-client socket events.
 */

export const CLIENT_EVENTS = {
  REQUEST_CHAT: 'request_chat',
  ACCEPT_CHAT: 'accept_chat',
  REJECT_CHAT: 'reject_chat',
  JOIN_SESSION: 'join_session',
  SEND_MESSAGE: 'send_message',
  TYPING: 'typing',
  END_CHAT: 'end_chat',
};

export const SERVER_EVENTS = {
  INCOMING_CHAT_REQUEST: 'incoming_chat_request',
  CHAT_REQUEST_ACCEPTED: 'chat_request_accepted',
  CHAT_REQUEST_REJECTED: 'chat_request_rejected',
  CHAT_STARTED: 'chat_started',
  CHAT_ENDED: 'chat_ended',
  RECEIVE_MESSAGE: 'receive_message',
  DISPLAY_TYPING: 'display_typing',
  LISTENER_STATUS_CHANGED: 'listener_status_changed',
  BALANCE_WARNING: 'balance_warning',
  ERROR: 'socket_error',

  // ─── Presence / Connection ──────────────────────────────────────
  LISTENER_ONLINE: 'listener_online',
  LISTENER_OFFLINE: 'listener_offline',
  USER_RECONNECTED: 'user_reconnected',
  USER_JOINED: 'user_joined',
};
