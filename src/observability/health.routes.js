import express from 'express';
import mongoose from 'mongoose';
import redisClient from '../config/redis.js';

const router = express.Router();

// 1. Deep Health Check - /health
router.get('/health', async (req, res) => {
  const startTime = Date.now();
  
  // Check MongoDB
  let mongoStatus = 'down';
  let mongoLatency = null;
  try {
    const mongoStart = Date.now();
    const state = mongoose.connection.readyState;
    if (state === 1) { // 1 = connected
      await mongoose.connection.db.admin().ping();
      mongoStatus = 'up';
      mongoLatency = `${Date.now() - mongoStart}ms`;
    } else {
      mongoStatus = state === 2 ? 'connecting' : 'disconnected';
    }
  } catch (err) {
    mongoStatus = 'degraded';
  }

  // Check Redis
  let redisStatus = 'down';
  let redisLatency = null;
  try {
    const redisStart = Date.now();
    if (redisClient && redisClient.isRedisAvailable) {
      await redisClient.ping();
      redisStatus = 'up';
      redisLatency = `${Date.now() - redisStart}ms`;
    } else {
      redisStatus = 'disabled';
    }
  } catch (err) {
    redisStatus = 'down';
  }

  // Node.js process memory
  const memoryUsage = process.memoryUsage();
  const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  const isHealthy = mongoStatus === 'up';

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'production',
    checks: {
      mongodb: { status: mongoStatus, latency: mongoLatency },
      redis: { status: redisStatus, latency: redisLatency },
      memory: {
        rss: formatMB(memoryUsage.rss),
        heapTotal: formatMB(memoryUsage.heapTotal),
        heapUsed: formatMB(memoryUsage.heapUsed),
        external: formatMB(memoryUsage.external)
      },
      cpu: {
        cpuUsage: process.cpuUsage()
      }
    },
    responseTime: `${Date.now() - startTime}ms`
  });
});

// 2. Readiness Probe - /ready
router.get('/ready', (req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1;
  if (mongoConnected) {
    return res.status(200).json({ status: 'ready', message: 'Service ready to receive traffic' });
  }
  return res.status(503).json({ status: 'not_ready', message: 'Database connection not ready' });
});

// 3. Liveness Probe - /live
router.get('/live', (req, res) => {
  return res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

export default router;
