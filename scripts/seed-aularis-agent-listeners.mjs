/**
 * Seed 5 approved listeners for aularis.agent@chatcorner.app
 * Sets agent commission and fills listener profiles with realistic data.
 *
 * Usage: node scripts/seed-aularis-agent-listeners.mjs
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/modules/user.model.js';
import ListenerProfile from '../src/modules/listener-profile.model.js';
import Wallet from '../src/modules/wallet.model.js';
import Country from '../src/modules/country.model.js';

dotenv.config();

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';
const AGENT_EMAIL = 'aularis.agent@chatcorner.app';
const AGENT_PASSWORD = 'password123';
const COMMISSION_PERCENT = 15;

const LISTENERS = [
  {
    user: {
      firstName: 'Priya',
      lastName: 'Sharma',
      username: 'priya_sharma',
      email: 'priya.listener@chatcorner.app',
      mobileNumber: '9876501001',
      gender: 'FEMALE',
    },
    profile: {
      bio: 'Warm and empathetic listener specializing in friendly conversations and daily life support.',
      categories: ['Friendly Talk', 'Casual Chat'],
      interests: ['Listening', 'Life Advice', 'Hobbies'],
      chatRate: 8,
      voiceRate: 12,
      videoRate: 18,
      availability: 'ONLINE',
      totalEarnings: 12500,
      totalSessions: 48,
      avgRating: 4.6,
      totalRatings: 32,
      anchorLevel: 2,
      giftsReceivedCount: 15,
    },
    wallet: { coinBalance: 850, totalRecharge: 1200 },
    countryName: 'India',
  },
  {
    user: {
      firstName: 'Rahul',
      lastName: 'Verma',
      username: 'rahul_verma',
      email: 'rahul.listener@chatcorner.app',
      mobileNumber: '9876501002',
      gender: 'MALE',
    },
    profile: {
      bio: 'Motivational coach helping you stay focused, confident, and productive every day.',
      categories: ['Motivation', 'Career Guidance'],
      interests: ['Motivation', 'Productivity', 'Goals'],
      chatRate: 10,
      voiceRate: 15,
      videoRate: 22,
      availability: 'BUSY',
      totalEarnings: 18200,
      totalSessions: 67,
      avgRating: 4.8,
      totalRatings: 41,
      anchorLevel: 3,
      giftsReceivedCount: 28,
    },
    wallet: { coinBalance: 1200, totalRecharge: 2000 },
    countryName: 'India',
  },
  {
    user: {
      firstName: 'Sneha',
      lastName: 'Patel',
      username: 'sneha_patel',
      email: 'sneha.listener@chatcorner.app',
      mobileNumber: '9876501003',
      gender: 'FEMALE',
    },
    profile: {
      bio: 'Mental wellness supporter — a safe space to vent, reflect, and feel heard without judgment.',
      categories: ['Mental Wellness', 'Friendly Talk'],
      interests: ['Wellness', 'Mindfulness', 'Anxiety Relief'],
      chatRate: 12,
      voiceRate: 18,
      videoRate: 25,
      availability: 'ONLINE',
      totalEarnings: 9800,
      totalSessions: 35,
      avgRating: 4.5,
      totalRatings: 22,
      anchorLevel: 1,
      giftsReceivedCount: 9,
    },
    wallet: { coinBalance: 620, totalRecharge: 900 },
    countryName: 'India',
  },
  {
    user: {
      firstName: 'Arjun',
      lastName: 'Singh',
      username: 'arjun_singh',
      email: 'arjun.listener@chatcorner.app',
      mobileNumber: '9876501004',
      gender: 'MALE',
    },
    profile: {
      bio: 'Career mentor with experience guiding students and professionals through tough decisions.',
      categories: ['Career Guidance', 'Motivation'],
      interests: ['Career', 'Interviews', 'Skills'],
      chatRate: 15,
      voiceRate: 20,
      videoRate: 30,
      availability: 'OFFLINE',
      totalEarnings: 22400,
      totalSessions: 82,
      avgRating: 4.9,
      totalRatings: 55,
      anchorLevel: 4,
      giftsReceivedCount: 42,
    },
    wallet: { coinBalance: 1500, totalRecharge: 3500 },
    countryName: 'United States',
  },
  {
    user: {
      firstName: 'Meera',
      lastName: 'Nair',
      username: 'meera_nair',
      email: 'meera.listener@chatcorner.app',
      mobileNumber: '9876501005',
      gender: 'FEMALE',
    },
    profile: {
      bio: 'Relationship advisor helping with communication, trust, and emotional clarity in relationships.',
      categories: ['Relationship Advice', 'Friendly Talk'],
      interests: ['Relationships', 'Communication', 'Counseling'],
      chatRate: 11,
      voiceRate: 16,
      videoRate: 24,
      availability: 'ONLINE',
      totalEarnings: 15600,
      totalSessions: 54,
      avgRating: 4.7,
      totalRatings: 38,
      anchorLevel: 2,
      giftsReceivedCount: 21,
    },
    wallet: { coinBalance: 940, totalRecharge: 1600 },
    countryName: 'India',
  },
];

async function resolveCountry(name) {
  return Country.findOne({ name: { $regex: `^${name}$`, $options: 'i' } }).lean();
}

async function upsertWallet(userId, data) {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = new Wallet({ userId, status: 'ACTIVE', ...data });
  } else {
    Object.assign(wallet, data);
  }
  await wallet.save();
  return wallet;
}

async function run() {
  console.log(`Connecting to DB…`);
  await mongoose.connect(DB_URI);
  console.log('Connected.\n');

  let agent = await User.findOne({ email: AGENT_EMAIL });
  if (!agent) {
    console.error(`Agent not found: ${AGENT_EMAIL}. Run create-and-approve-agent.js first.`);
    process.exit(1);
  }

  agent.type = 'AGENT';
  agent.commissionPercentage = COMMISSION_PERCENT;
  agent.password = AGENT_PASSWORD;
  agent.profileCompleted = true;
  await agent.save();
  console.log(`Agent updated: ${agent.fullName} (${agent.email})`);
  console.log(`  Commission: ${agent.commissionPercentage}%`);
  console.log(`  Password reset to: ${AGENT_PASSWORD}\n`);

  await upsertWallet(agent._id, { coinBalance: 5000, totalRecharge: 10000 });
  console.log('Agent wallet initialized.\n');

  const now = new Date();
  const results = [];

  for (const entry of LISTENERS) {
    const country = await resolveCountry(entry.countryName);
    const countryId = country?._id ?? null;
    const countryCode = country?.code ?? undefined;

    let user = await User.findOne({
      $or: [
        { email: entry.user.email },
        { username: entry.user.username },
        { mobileNumber: entry.user.mobileNumber },
      ],
    });

    if (!user) {
      user = new User({
        ...entry.user,
        type: 'LISTENER',
        password: AGENT_PASSWORD,
        profileCompleted: true,
        isOnline: entry.profile.availability !== 'OFFLINE',
        country: countryId,
        countryCode,
      });
    } else {
      Object.assign(user, {
        ...entry.user,
        type: 'LISTENER',
        profileCompleted: true,
        isOnline: entry.profile.availability !== 'OFFLINE',
        country: countryId,
        countryCode,
      });
      if (entry.user.password) user.password = entry.user.password;
    }
    await user.save();

    let profile = await ListenerProfile.findOne({ userId: user._id });
    const profilePayload = {
      ...entry.profile,
      userId: user._id,
      createdByAgentId: agent._id,
      country: countryId,
      profileStatus: 'completed',
      kycStatus: 'APPROVED',
      kycApprovedAt: now,
      availableBalance: Math.round(entry.profile.totalEarnings * 0.4),
      withdrawnAmount: Math.round(entry.profile.totalEarnings * 0.1),
      magicLoginToken: profile?.magicLoginToken ?? crypto.randomBytes(32).toString('hex'),
      documentType: 'AADHAAR',
      documentFront: 'https://via.placeholder.com/400x250?text=KYC+Front',
      documentBack: 'https://via.placeholder.com/400x250?text=KYC+Back',
      selfieImage: 'https://via.placeholder.com/200x200?text=Selfie',
    };

    if (!profile) {
      profile = new ListenerProfile(profilePayload);
    } else {
      Object.assign(profile, profilePayload);
    }
    await profile.save();

    await upsertWallet(user._id, entry.wallet);

    results.push({
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      kyc: profile.kycStatus,
      earnings: profile.totalEarnings,
      availability: profile.availability,
    });

    console.log(`✓ ${user.firstName} ${user.lastName} — KYC ${profile.kycStatus}, earnings ${profile.totalEarnings} coins`);
  }

  console.log('\n--- SUMMARY ---');
  console.log(`Agent: ${AGENT_EMAIL} / ${AGENT_PASSWORD}`);
  console.log(`Commission: ${COMMISSION_PERCENT}%`);
  console.log(`Listeners created/updated: ${results.length}`);
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name} (${r.email}) — ${r.kyc}, ${r.availability}, ${r.earnings} coins earned`);
  });

  await mongoose.disconnect();
  console.log('\nDone.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
