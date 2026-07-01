/**
 * Align a listener profile with a customer for match/discover testing.
 * Usage: node scripts/sync-listener-for-customer.mjs
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const CUSTOMER_ID = '6a32445cd61900d4c18f58c9';
const LISTENER_ID = '6a3245bb0d3a67122fdcd4b2';

const MATCH_TEST_PROFILE = {
  bio: 'Professional relationship counselor — aligned for match testing with your customer profile.',
  categories: ['Relationship Advice', 'Casual Chat', 'Friendly Talk'],
  interests: ['Counseling', 'Life Advice'],
  chatRate: 10,
  voiceRate: 15,
  videoRate: 20,
  kycStatus: 'APPROVED',
  availability: 'ONLINE',
  isFeatured: true,
  anchorLevel: 2,
  avgRating: 4.8,
  totalRatings: 12,
  profileStatus: 'completed',
};

const CUSTOMER_WALLET_MIN = 500;

async function main() {
  const [
    { default: User },
    { default: ListenerProfile },
    { default: Wallet },
    { default: Country },
    { bumpCacheVersion, deleteCache },
    { default: redisClient },
    { KEYS },
  ] = await Promise.all([
    import('../src/modules/user.model.js'),
    import('../src/modules/listener-profile.model.js'),
    import('../src/modules/wallet.model.js'),
    import('../src/modules/country.model.js'),
    import('../src/utils/redis.util.js'),
    import('../src/config/redis.js'),
    import('../src/utils/socket-redis-keys.util.js'),
  ]);

  await mongoose.connect(process.env.DATABASE_URI);

  const customer = await User.findById(CUSTOMER_ID);
  if (!customer) throw new Error(`Customer not found: ${CUSTOMER_ID}`);

  // Ensure customer has India country for same-country discover/match testing
  if (!customer.country) {
    const india = await Country.findOne({ code: 'IN' }).lean();
    if (india) {
      customer.country = india._id;
      customer.countryCode = customer.countryCode || '+91';
      await customer.save();
    }
  }

  const listenerUser = await User.findById(LISTENER_ID);
  if (!listenerUser) throw new Error(`Listener user not found: ${LISTENER_ID}`);

  let profile = await ListenerProfile.findOne({ userId: LISTENER_ID });
  if (!profile) throw new Error(`Listener profile not found for user: ${LISTENER_ID}`);

  const countryId = customer.country || null;
  let countryDoc = null;
  if (countryId) {
    countryDoc = await Country.findById(countryId).lean();
  }

  const customerLean = customer.toObject();

  // Mirror customer locale onto listener user + profile
  if (countryId) {
    listenerUser.country = countryId;
  }
  if (customer.countryCode) {
    listenerUser.countryCode = customer.countryCode;
  }
  if (customer.languages?.length) {
    listenerUser.languages = customer.languages;
  }
  listenerUser.profileCompleted = true;
  await listenerUser.save();

  Object.assign(profile, MATCH_TEST_PROFILE);
  if (countryId) profile.country = countryId;
  if (customer.languages?.length) profile.languages = customer.languages;
  if (!profile.kycApprovedAt && profile.kycStatus === 'APPROVED') {
    profile.kycApprovedAt = new Date();
  }
  await profile.save();

  // Ensure customer can afford instant match
  let wallet = await Wallet.findOne({ userId: CUSTOMER_ID });
  if (!wallet) {
    wallet = await Wallet.create({ userId: CUSTOMER_ID, coinBalance: CUSTOMER_WALLET_MIN });
  } else if (wallet.coinBalance < CUSTOMER_WALLET_MIN) {
    wallet.coinBalance = CUSTOMER_WALLET_MIN;
    await wallet.save();
  }

  await Promise.all([
    deleteCache(`user:${CUSTOMER_ID}`),
    deleteCache(`user:${LISTENER_ID}`),
    deleteCache(`listener:${LISTENER_ID}`),
    deleteCache(`auth:user:${CUSTOMER_ID}`),
    deleteCache(`auth:user:${LISTENER_ID}`),
    bumpCacheVersion('listeners'),
  ]);

  if (redisClient.isRedisAvailable) {
    await redisClient.set(KEYS.presenceStatus(LISTENER_ID), 'ONLINE');
  }

  const updated = await ListenerProfile.findOne({ userId: LISTENER_ID })
    .populate('country')
    .lean();

  console.log(JSON.stringify({
    message: 'Listener aligned with customer for match/discover testing',
    customer: {
      id: customerLean._id.toString(),
      name: `${customerLean.firstName || ''} ${customerLean.lastName || ''}`.trim(),
      country: countryDoc ? { id: countryDoc._id, name: countryDoc.name, code: countryDoc.code } : null,
      countryCode: customerLean.countryCode,
      languages: customerLean.languages,
      coinBalance: wallet.coinBalance,
    },
    listener: {
      id: LISTENER_ID,
      name: `${listenerUser.firstName || ''} ${listenerUser.lastName || ''}`.trim(),
      profile: {
        listenerId: LISTENER_ID,
        country: updated.country,
        categories: updated.categories,
        languages: updated.languages,
        chatRate: updated.chatRate,
        voiceRate: updated.voiceRate,
        videoRate: updated.videoRate,
        kycStatus: updated.kycStatus,
        availability: updated.availability,
        anchorLevel: updated.anchorLevel,
        avgRating: updated.avgRating,
        isFeatured: updated.isFeatured,
      },
      listenerJwtHint: 'Use the LISTENER token you already have in test.html',
    },
    testCalls: {
      discover: 'GET /api/v1/match/discover?page=1&limit=10',
      instantMatch: 'POST /api/v1/match/instant { "mode": "CHAT" }',
      socketChat: 'request_chat with listenerId 6a3245bb0d3a67122fdcd4b2',
    },
  }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
