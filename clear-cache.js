import Redis from 'ioredis';
import dotenv from 'dotenv';
import config from './src/config/index.js';

dotenv.config();

async function run() {
  const redisOpts = {
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password ? { password: config.redis.password } : {}),
  };
  const redis = new Redis(redisOpts);
  try {
    console.log(`Connecting to Redis at: ${redisOpts.host}:${redisOpts.port}`);
    
    // Delete version keys
    await redis.del('coin_packs:version');
    await redis.del('listeners:version');
    await redis.del('users:version');
    
    // Scan and delete keys
    const keys = await redis.keys('*');
    if (keys && keys.length > 0) {
      console.log(`Found ${keys.length} keys in Redis.`);
      const keysToDelete = keys.filter(k => 
        k.startsWith('coin_packs') || 
        k.startsWith('listeners') || 
        k.startsWith('users') ||
        k.startsWith('user') ||
        k.startsWith('auth:user')
      );
      if (keysToDelete.length > 0) {
        console.log('Deleting keys:', keysToDelete);
        await redis.del(...keysToDelete);
      }
    }
    
    console.log('Redis Cache cleared successfully.');
    redis.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error clearing cache:', err);
    redis.disconnect();
    process.exit(1);
  }
}

run();
