import mongoose from 'mongoose';
import dotenv from 'dotenv';
import coinPackService from './src/services/coin-pack.service.js';
import { connectRedis } from './src/config/redis.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

async function run() {
  try {
    await mongoose.connect(DB_URI);
    await connectRedis();
    
    // Wait for redis connection
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Fetching coin packs via service...');
    const packs = await coinPackService.getAllCoinPacks();
    console.log('Result:', JSON.stringify(packs, null, 2));

    mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error fetching coin packs:', err);
    process.exit(1);
  }
}

run();
