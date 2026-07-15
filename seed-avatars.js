import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Redis from 'ioredis';
import Avatar from './src/modules/avatar.model.js';
import config from './src/config/index.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

const avatarsData = [
  // 2 Free Avatars
  {
    name: 'Default Boy',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=DefaultBoy',
    priceType: 'FREE',
    price: 0,
    category: 'REGULAR',
    isActive: true
  },
  {
    name: 'Default Girl',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=DefaultGirl',
    priceType: 'FREE',
    price: 0,
    category: 'REGULAR',
    isActive: true
  },
  // 8 Paid Avatars
  {
    name: 'Cyber Ninja',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=CyberNinja',
    priceType: 'PAID',
    price: 15,
    category: 'REGULAR',
    isActive: true
  },
  {
    name: 'Steampunk Inventor',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=Steampunk',
    priceType: 'PAID',
    price: 25,
    category: 'REGULAR',
    isActive: true
  },
  {
    name: 'Cosmic Voyager',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=CosmicVoyager',
    priceType: 'PAID',
    price: 35,
    category: 'PREMIUM',
    isActive: true
  },
  {
    name: 'Neon Hacker',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=NeonHacker',
    priceType: 'PAID',
    price: 45,
    category: 'PREMIUM',
    isActive: true
  },
  {
    name: 'Shadow Samurai',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=ShadowSamurai',
    priceType: 'PAID',
    price: 50,
    category: 'PREMIUM',
    isActive: true
  },
  {
    name: 'Retro Pixel',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=RetroPixel',
    priceType: 'PAID',
    price: 20,
    category: 'REGULAR',
    isActive: true
  },
  {
    name: 'Mystic Sorcerer',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=MysticSorcerer',
    priceType: 'PAID',
    price: 75,
    category: 'SPECIAL',
    isActive: true
  },
  {
    name: 'Golden Monarch',
    image: 'https://api.dicebear.com/7.x/bottts/svg?seed=GoldenMonarch',
    priceType: 'PAID',
    price: 100,
    category: 'SPECIAL',
    isActive: true
  }
];

async function run() {
  try {
    console.log(`Connecting to DB: ${DB_URI}`);
    await mongoose.connect(DB_URI);
    console.log('Connected to DB successfully!');

    console.log('Cleaning up existing avatars...');
    await Avatar.deleteMany({});

    console.log('Seeding new avatars...');
    const seededAvatars = await Avatar.insertMany(avatarsData);
    console.log(`Successfully created ${seededAvatars.length} avatars!`);

    // Clear Redis Cache for avatars
    try {
      console.log(`Connecting to Redis at: ${config.redis.host}:${config.redis.port}`);
      const redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        ...(config.redis.password ? { password: config.redis.password } : {}),
      });
      await redis.del('avatars:active_list');
      console.log('Redis cache key "avatars:active_list" cleared.');
      redis.disconnect();
    } catch (redisErr) {
      console.error('Failed to clear Redis cache:', redisErr.message);
    }

    console.log('Avatar database seeding completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding database:', err);
    process.exit(1);
  }
}

run();
