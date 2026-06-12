let ioInstance = null;

/**
 * Set the global Socket.io server instance.
 */
export const setSocketIo = (io) => {
  ioInstance = io;
};

/**
 * Get the global Socket.io server instance.
 */
export const getSocketIo = () => {
  return ioInstance;
};

/**
 * Emit a real-time event to a specific user's private room.
 */
export const emitToUser = (userId, eventName, data) => {
  if (ioInstance) {
    ioInstance.to(userId.toString()).emit(eventName, data);
  }
};
