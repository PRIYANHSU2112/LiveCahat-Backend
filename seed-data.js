import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/modules/user.model.js';
import ListenerProfile from './src/modules/listener-profile.model.js';
import CoinPack from './src/modules/coin-pack.model.js';
import Wallet from './src/modules/wallet.model.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

const coinPacksData = [
  {
    name: 'Starter Pack',
    coins: 50,
    price: 49,
    currency: 'INR',
    badge: 'Value Pack',
    description: 'Ideal for quick casual chats.',
    isActive: true
  },
  {
    name: 'Popular Pack',
    coins: 120,
    price: 99,
    currency: 'INR',
    badge: 'Most Popular',
    description: 'Get more value for longer conversations.',
    isActive: true
  },
  {
    name: 'Super Saver',
    coins: 300,
    price: 249,
    currency: 'INR',
    badge: 'Best Value',
    description: 'Our best rate for deep venting sessions.',
    isActive: true
  },
  {
    name: 'Mega Pack',
    coins: 650,
    price: 499,
    currency: 'INR',
    badge: 'Mega Saver',
    description: 'Uninterrupted talking time.',
    isActive: true
  },
  {
    name: 'Ultimate Pack',
    coins: 1500,
    price: 999,
    currency: 'INR',
    badge: 'Premium Choice',
    description: 'For long term advice and coaching sessions.',
    isActive: true
  }
];

const listenersData = [
  {
    user: {
      firstName: 'Aarav',
      lastName: 'Mehta',
      email: 'aarav@livechat.com',
      mobileNumber: '9999911111',
      type: 'LISTENER',
      gender: 'MALE',
      profileCompleted: true,
      isOnline: true,
      password: 'password123'
    },
    profile: {
      bio: 'Professional relationship counselor and life coach. Let\'s talk and resolve your doubts!',
      categories: ['Relationship Advice', 'Casual Chat'],
      interests: ['Counseling', 'Life Advice', 'Meditation'],
      chatRate: 10,
      voiceRate: 15,
      videoRate: 20,
      kycStatus: 'APPROVED',
      availability: 'ONLINE'
    }
  },
  {
    user: {
      firstName: 'Ananya',
      lastName: 'Iyer',
      email: 'ananya@livechat.com',
      mobileNumber: '9999922222',
      type: 'LISTENER',
      gender: 'FEMALE',
      profileCompleted: true,
      isOnline: true,
      password: 'password123'
    },
    profile: {
      bio: 'Experienced wellness coach and motivational speaker. Let\'s find your peace.',
      categories: ['Motivation', 'Mental Wellness'],
      interests: ['Motivation', 'Wellness', 'Anxiety Relief'],
      chatRate: 12,
      voiceRate: 18,
      videoRate: 25,
      kycStatus: 'APPROVED',
      availability: 'ONLINE'
    }
  }
];

async function run() {
  try {
    console.log(`Connecting to DB: ${DB_URI}`);
    await mongoose.connect(DB_URI);
    console.log('Connected to DB successfully!');

    // 1. Create/Update Listeners
    for (const data of listenersData) {
      // Find if user already exists
      let user = await User.findOne({
        $or: [
          { email: data.user.email },
          { mobileNumber: data.user.mobileNumber }
        ]
      });

      if (!user) {
        user = new User(data.user);
        await user.save();
        console.log(`Created listener user: ${user.fullName} (${user.email})`);
      } else {
        // Update user properties
        user.type = 'LISTENER';
        user.firstName = data.user.firstName;
        user.lastName = data.user.lastName;
        user.gender = data.user.gender;
        user.profileCompleted = true;
        user.isOnline = true;
        await user.save();
        console.log(`Updated listener user: ${user.fullName} (${user.email})`);
      }

      // Check / Create profile
      let profile = await ListenerProfile.findOne({ userId: user._id });
      if (!profile) {
        profile = new ListenerProfile({
          userId: user._id,
          ...data.profile
        });
        await profile.save();
        console.log(`Created listener profile for: ${user.fullName}`);
      } else {
        // Update existing profile
        Object.assign(profile, data.profile);
        await profile.save();
        console.log(`Updated listener profile for: ${user.fullName}`);
      }

      // Initialize wallet if not exists
      let wallet = await Wallet.findOne({ userId: user._id });
      if (!wallet) {
        wallet = new Wallet({
          userId: user._id,
          coinBalance: 100, // starting coins for testing
          status: 'ACTIVE'
        });
        await wallet.save();
        console.log(`Initialized wallet for listener: ${user.fullName}`);
      }
    }

    // 2. Create Coin Packs
    console.log('Cleaning up existing coin packs...');
    await CoinPack.deleteMany({});
    
    console.log('Seeding new coin packs...');
    const seededPacks = await CoinPack.insertMany(coinPacksData);
    console.log(`Successfully created ${seededPacks.length} coin packs!`);

    console.log('All DB seed operations completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding database:', err);
    process.exit(1);
  }
}

run();
