/**
 * Helper utilities for Socket.io session rooms.
 */

/**
 * Join a socket connection to a specific session room.
 */
export const joinSessionRoom = (socket, sessionId) => {
  const roomName = `session:${sessionId}`;
  socket.join(roomName);
};

/**
 * Leave a socket connection from a specific session room.
 */
export const leaveSessionRoom = (socket, sessionId) => {
  const roomName = `session:${sessionId}`;
  socket.leave(roomName);
};

/**
 * Emit an event to all users connected to a specific session room.
 */
export const emitToSession = (io, sessionId, event, data) => {
  const roomName = `session:${sessionId}`;
  io.to(roomName).emit(event, data);
};

/**
 * Retrieve the number of active socket connections in a session room.
 */
export const getSessionRoomSize = (io, sessionId) => {
  const roomName = `session:${sessionId}`;
  const clients = io.sockets.adapter.rooms.get(roomName);
  return clients ? clients.size : 0;
};
