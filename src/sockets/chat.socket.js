import logger from '../utils/logger.util.js';
import redisClient from '../config/redis.js';

export const handleChatEvents = (io, socket) => {
  // Assuming auth middleware attached user to socket
  const userId = socket.user?.id || 'anonymous';

  socket.on('send_message', async (data) => {
    logger.info(`Message from ${userId} to room ${data.roomId}`);
    
    // Validate payload, save to DB via Service layer, then broadcast:
    io.to(data.roomId).emit('receive_message', {
      senderId: userId,
      message: data.text,
      timestamp: new Date(),
    });
  });

  socket.on('typing', (data) => {
    socket.to(data.roomId).emit('display_typing', { userId });
  });

  // Manage Online Presence
  socket.on('disconnect', async () => {
    // Update presence in Redis
    await redisClient.hdel('online_users', userId);
    logger.info(`User ${userId} went offline`);
  });
};
