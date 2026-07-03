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

  // ─── Call (Audio / Video) ─────────────────────────────────────
  REQUEST_CALL: 'request_call',
  ACCEPT_CALL: 'accept_call',
  REJECT_CALL: 'reject_call',
  END_CALL: 'end_call',

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

  // ─── Group Live Room ──────────────────────────────────────────
  LIVE_STARTED: 'live:started',
  LIVE_ENDED: 'live:ended',
  LIVE_VIEWER_JOINED: 'live:viewer_joined',
  LIVE_VIEWER_LEFT: 'live:viewer_left',
  LIVE_NEW_COMMENT: 'live:new_comment',
  LIVE_LIKE_UPDATE: 'live:like_update',
  // ─── Agent Dashboard ─────────────────────────────────────────────
  AGENT_DASHBOARD_LIVE: 'agent:dashboard:live',
  AGENT_ACTIVITY: 'agent:activity',
};
