import { createServer } from 'http';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pubClient, subClient, connectRedis } from './config/redis.js';
import app from './app.js';
import logger from './utils/logger.util.js';

dotenv.config();

process.on('uncaughtException', err => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(err.name, err.message);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

// Server & Socket Init
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Redis Adapter for Socket.io Scaling
io.adapter(createAdapter(pubClient, subClient));

io.on('connection', (socket) => {
  logger.info(`New client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Database Connection
mongoose.connect(DB_URI)
  .then(async () => {
    logger.info('DB connection successful!');
    
    // Attempt Redis connection after DB
    await connectRedis();

    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}...`);
    });
  })
  .catch((err) => {
    logger.error('DB Connection Error:', err);
  });

process.on('unhandledRejection', err => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  logger.error(err);
  httpServer.close(() => {
    process.exit(1);
  });
});
