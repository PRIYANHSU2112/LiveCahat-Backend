import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/modules/user.model.js';
import ListenerProfile from './src/modules/listener-profile.model.js';
import Wallet from './src/modules/wallet.model.js';
import Country from './src/modules/country.model.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

async function run() {
  try {
    console.log(`Connecting to DB: ${DB_URI}`);
    await mongoose.connect(DB_URI);
    console.log('Connected to DB successfully!');

    // 1. Resolve a country to use (fallback to null if none exists)
    const country = await Country.findOne().lean();
    const countryId = country ? country._id : null;
    const countryCode = country ? country.code : undefined;
    console.log(`Using country: ${country ? country.name : 'None (using null)'}`);

    // 2. Create or find the Agent user
    let agentUser = await User.findOne({ email: 'aularis.agent@chatcorner.app' });
    if (!agentUser) {
      agentUser = new User({
        type: 'AGENT',
        firstName: 'Aularis',
        lastName: 'Agent',
        email: 'aularis.agent@chatcorner.app',
        mobileNumber: '8888877777',
        password: 'password123',
        inviteCode: 'AGT-AUL1',
        profileCompleted: true,
        country: countryId,
        countryCode: countryCode,
      });
      await agentUser.save();
      console.log(`Created AGENT user: ${agentUser.fullName} (${agentUser.email})`);
    } else {
      agentUser.type = 'AGENT';
      agentUser.firstName = 'Aularis';
      agentUser.lastName = 'Agent';
      agentUser.mobileNumber = '8888877777';
      agentUser.profileCompleted = true;
      await agentUser.save();
      console.log(`AGENT user already exists, updated: ${agentUser.fullName} (${agentUser.email})`);
    }

    // Initialize wallet for agent
    let agentWallet = await Wallet.findOne({ userId: agentUser._id });
    if (!agentWallet) {
      agentWallet = new Wallet({
        userId: agentUser._id,
        coinBalance: 0,
        status: 'ACTIVE'
      });
      await agentWallet.save();
      console.log(`Initialized wallet for AGENT: ${agentUser.fullName}`);
    }

    // 3. Create or find the Listener user
    let listenerUser = await User.findOne({ email: 'aularis.listener@chatcorner.app' });
    if (!listenerUser) {
      listenerUser = new User({
        type: 'LISTENER',
        firstName: 'Aularis',
        lastName: 'Listener',
        email: 'aularis.listener@chatcorner.app',
        mobileNumber: '9999988888',
        password: 'password123',
        gender: 'FEMALE',
        dateOfBirth: new Date('1995-01-01'),
        profileCompleted: true,
        isOnline: true,
        country: countryId,
        countryCode: countryCode,
      });
      await listenerUser.save();
      console.log(`Created LISTENER user: ${listenerUser.fullName} (${listenerUser.email})`);
    } else {
      listenerUser.type = 'LISTENER';
      listenerUser.firstName = 'Aularis';
      listenerUser.lastName = 'Listener';
      listenerUser.mobileNumber = '9999988888';
      listenerUser.profileCompleted = true;
      listenerUser.isOnline = true;
      await listenerUser.save();
      console.log(`LISTENER user already exists, updated: ${listenerUser.fullName} (${listenerUser.email})`);
    }

    // Initialize wallet for listener
    let listenerWallet = await Wallet.findOne({ userId: listenerUser._id });
    if (!listenerWallet) {
      listenerWallet = new Wallet({
        userId: listenerUser._id,
        coinBalance: 100, // starting coins
        status: 'ACTIVE'
      });
      await listenerWallet.save();
      console.log(`Initialized wallet for LISTENER: ${listenerUser.fullName}`);
    }

    // 4. Create or update the Listener profile and approve it
    let profile = await ListenerProfile.findOne({ userId: listenerUser._id });
    const profileData = {
      bio: 'Professional relationship counselor and life coach. Let\'s talk!',
      categories: ['Friendly Talk', 'Casual Chat'],
      interests: ['Counseling', 'Life Advice', 'Meditation'],
      chatRate: 10,
      voiceRate: 15,
      videoRate: 20,
      kycStatus: 'APPROVED',
      availability: 'ONLINE',
      createdByAgentId: agentUser._id,
      profileStatus: 'completed',
      country: countryId
    };

    if (!profile) {
      profile = new ListenerProfile({
        userId: listenerUser._id,
        ...profileData
      });
      await profile.save();
      console.log(`Created and APPROVED listener profile for: ${listenerUser.fullName}`);
    } else {
      Object.assign(profile, profileData);
      await profile.save();
      console.log(`Updated and APPROVED listener profile for: ${listenerUser.fullName}`);
    }

    console.log('\n--- OPERATION SUMMARY ---');
    console.log('Agent User ID:', agentUser._id);
    console.log('Agent Name:', agentUser.fullName);
    console.log('Agent Email:', agentUser.email);
    console.log('Listener User ID:', listenerUser._id);
    console.log('Listener Name:', listenerUser.fullName);
    console.log('Listener Email:', listenerUser.email);
    console.log('Listener KYC Status:', profile.kycStatus);
    console.log('Listener Rates:', `Chat: ${profile.chatRate}, Voice: ${profile.voiceRate}, Video: ${profile.videoRate}`);

    console.log('\nSuccess! Exiting...');
    process.exit(0);
  } catch (err) {
    console.error('Error running script:', err);
    process.exit(1);
  }
}

run();
