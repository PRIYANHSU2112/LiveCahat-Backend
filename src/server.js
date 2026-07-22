import { createServer } from 'http';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { pubClient, subClient, connectRedis } from './config/redis.js';
import app from './app.js';
import config from './config/index.js';
import logger from './utils/logger.util.js';

dotenv.config();

process.on('uncaughtException', err => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(err.stack || err);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

import { initializeSockets } from './sockets/index.js';
import { initializeBillingJob } from './jobs/billing.job.js';
import { initializeSettlementJob } from './jobs/settlement.job.js';
import dailyRewardService from './services/daily-reward.service.js';
import settingsRuntime from './services/settings-runtime.service.js';

// Server & Socket Init
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  serveClient: true,
  path: '/socket.io',
});

// Redis Adapter for Socket.io Scaling
io.adapter(createAdapter(pubClient, subClient));

// Initialize Socket.io Server (Bootstrap)
initializeSockets(io);

// Database Connection
mongoose.connect(DB_URI)
  .then(async () => {
    logger.info('DB connection successful!');
    
    // Seed default daily login reward configs and chests
    await dailyRewardService.seedDefaultConfig();
    
    // Attempt Redis connection after DB
    await connectRedis();

    // Warm platform/payment settings into memory (O(1) hot-path reads)
    await settingsRuntime.warm();
    await settingsRuntime.startSubscriber();

    // Start background cron jobs
    initializeBillingJob(io);
    initializeSettlementJob();

    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}...`);
      if (config.agora.appId) {
        const masked = `${config.agora.appId.slice(0, 4)}...${config.agora.appId.slice(-4)}`;
        logger.info(`[Agora] App ID ${masked}, auth mode: ${config.agora.authMode}`);
      }
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
