import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ListenerProfile from './src/modules/listener-profile.model.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

async function run() {
  try {
    await mongoose.connect(DB_URI);
    console.log('Connected to DB');

    // Approve all listener profiles and set chat rate to 10
    const result = await ListenerProfile.updateMany(
      {},
      { 
        kycStatus: 'APPROVED', 
        chatRate: 10,
        voiceRate: 15,
        videoRate: 20
      }
    );

    console.log(`Successfully approved and configured ${result.modifiedCount} listener profiles.`);
    process.exit(0);
  } catch (err) {
    console.error('Error updating DB:', err);
    process.exit(1);
  }
}

run();
