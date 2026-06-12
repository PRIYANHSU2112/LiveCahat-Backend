import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/modules/user.model.js';
import ListenerProfile from './src/modules/listener-profile.model.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

async function run() {
  try {
    await mongoose.connect(DB_URI);
    console.log('Connected to DB');

    const userCount = await User.countDocuments();
    const listenersCount = await ListenerProfile.countDocuments();

    console.log('--- DB SUMMARY ---');
    console.log(`Total Users: ${userCount}`);
    console.log(`Total Listener Profiles: ${listenersCount}`);

    const users = await User.find().select('firstName lastName type email mobileNumber isBlocked isDeleted').lean();
    console.log('\n--- ALL USERS ---');
    console.log(JSON.stringify(users, null, 2));

    const listeners = await ListenerProfile.find().lean();
    console.log('\n--- ALL LISTENERS ---');
    console.log(JSON.stringify(listeners, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error querying DB:', err);
    process.exit(1);
  }
}

run();
