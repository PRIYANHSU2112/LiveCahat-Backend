import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Import models
import User from '../src/modules/user.model.js';
import Wallet from '../src/modules/wallet.model.js';
import ListenerProfile from '../src/modules/listener-profile.model.js';
import CoinTransaction from '../src/modules/coin-transaction.model.js';
import CommunicationSession from '../src/modules/communication-session.model.js';
import SessionSegment from '../src/modules/session-segment.model.js';
import LiveRoom from '../src/modules/live-room.model.js';
import Gift from '../src/modules/gift.model.js';
import GiftTransaction from '../src/modules/gift-transaction.model.js';

// Import services
import billingService from '../src/services/billing.service.js';
import liveBillingService from '../src/services/live-billing.service.js';
import giftService from '../src/services/gift.service.js';
import redisClient from '../src/config/redis.js';

async function runLiveBillingVerification() {
  console.log('===============================================================');
  console.log('🚀 STARTING FULL LIVE TESTING: MONEY DEDUCTION & LISTENER CREDIT');
  console.log('===============================================================\n');

  const mongoUri = process.env.DATABASE_URI;
  if (!mongoUri) {
    throw new Error('DATABASE_URI is not defined in .env');
  }

  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB connected successfully to database:', mongoose.connection.name);

  // 1. SETUP TEST USERS (Customer + Listener)
  const testCustomerEmail = `test_customer_${Date.now()}@livechat-test.com`;
  const testListenerEmail = `test_listener_${Date.now()}@livechat-test.com`;

  const customer = await User.create({
    phoneNumber: `+9199${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: testCustomerEmail,
    firstName: 'LiveTest',
    lastName: 'Customer',
    type: 'CUSTOMER',
    isPhoneVerified: true,
    isProfileComplete: true,
  });

  const listener = await User.create({
    phoneNumber: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
    email: testListenerEmail,
    firstName: 'LiveTest',
    lastName: 'Listener',
    type: 'LISTENER',
    isPhoneVerified: true,
    isProfileComplete: true,
  });

  // Setup initial wallets
  const customerWallet = await Wallet.create({
    userId: customer._id,
    coinBalance: 500, // Initial 500 coins
    totalRecharge: 500,
    totalSpent: 0,
    totalEarned: 0,
    status: 'ACTIVE'
  });

  const listenerWallet = await Wallet.create({
    userId: listener._id,
    coinBalance: 0,
    totalRecharge: 0,
    totalSpent: 0,
    totalEarned: 0,
    status: 'ACTIVE'
  });

  const listenerProfile = await ListenerProfile.create({
    userId: listener._id,
    chatRate: 10,
    voiceRate: 20,
    videoRate: 30,
    earningPercent: 70, // 70% listener share, 30% platform
    availableBalance: 0,
    totalEarnings: 0,
    approvalStatus: 'APPROVED',
    kycStatus: 'APPROVED'
  });

  console.log(`\n👤 Test Users Initialized:`);
  console.log(`   - Customer: ${customer.firstName} (${customer._id}) | Balance: ${customerWallet.coinBalance} coins`);
  console.log(`   - Listener: ${listener.firstName} (${listener._id}) | Balance: ${listenerWallet.coinBalance} coins | Profile Available: ${listenerProfile.availableBalance}`);

  const results = [];

  try {
    // ═════════════════════════════════════════════════════════════════════
    // TEST SUITE 1: 1-ON-1 AUDIO CALL BILLING & DEDUCTION
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('🧪 TEST 1: 1-on-1 Call Billing (Customer debited, Listener credited)');
    console.log('───────────────────────────────────────────────────────────────');

    const sessionStartTime = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes ago
    const callSession = await CommunicationSession.create({
      callerId: customer._id,
      listenerId: listener._id,
      mode: 'AUDIO',
      status: 'ONGOING',
      startTime: sessionStartTime
    });

    const sessionSegment = await SessionSegment.create({
      sessionId: callSession._id,
      mode: 'AUDIO',
      ratePerMinute: 20, // 20 coins/min
      status: 'ONGOING',
      coinsCharged: 0,
      startedAt: sessionStartTime
    });

    // Populate Redis active session if available
    if (redisClient.isRedisAvailable) {
      await redisClient.hset(`active_session:${callSession._id}`, {
        callerId: customer._id.toString(),
        listenerId: listener._id.toString(),
        ratePerMinute: '20',
        startTime: sessionStartTime.toISOString(),
        lastBilledAt: sessionStartTime.toISOString(),
        segmentId: sessionSegment._id.toString()
      });
    }

    // Process billing for 3 minutes (3 * 20 = 60 coins total; Listener 70% = 42 coins)
    const billTimePoint = new Date();
    await billingService.billSession(callSession._id.toString(), billTimePoint, true);

    // Verify wallets & transactions
    const updatedCustWallet1 = await Wallet.findOne({ userId: customer._id });
    const updatedListWallet1 = await Wallet.findOne({ userId: listener._id });
    const updatedListProf1 = await ListenerProfile.findOne({ userId: listener._id });
    const custTxs1 = await CoinTransaction.find({ userId: customer._id }).sort({ createdAt: -1 });
    const listTxs1 = await CoinTransaction.find({ userId: listener._id }).sort({ createdAt: -1 });

    console.log(`📊 Test 1 Results:`);
    console.log(`   - Customer Balance: 500 -> ${updatedCustWallet1.coinBalance} (Spent: ${updatedCustWallet1.totalSpent}) [Expected: 440, Spent: 60]`);
    console.log(`   - Listener Wallet: 0 -> ${updatedListWallet1.coinBalance} (Earned: ${updatedListWallet1.totalEarned}) [Expected: 42, Earned: 42]`);
    console.log(`   - Listener Profile: 0 -> Available: ${updatedListProf1.availableBalance}, Total: ${updatedListProf1.totalEarnings} [Expected: 42]`);
    console.log(`   - Customer CoinTransaction: Type=${custTxs1[0]?.type}, Amount=${custTxs1[0]?.amount}, BalanceAfter=${custTxs1[0]?.balanceAfter}, Ref=${custTxs1[0]?.referenceType}`);
    console.log(`   - Listener CoinTransaction: Type=${listTxs1[0]?.type}, Amount=${listTxs1[0]?.amount}, BalanceAfter=${listTxs1[0]?.balanceAfter}, Ref=${listTxs1[0]?.referenceType}`);

    const test1Passed = (
      updatedCustWallet1.coinBalance === 440 &&
      updatedCustWallet1.totalSpent === 60 &&
      updatedListWallet1.coinBalance === 42 &&
      updatedListProf1.availableBalance === 42 &&
      custTxs1[0]?.type === 'DEBIT' &&
      custTxs1[0]?.amount === 60 &&
      custTxs1[0]?.balanceAfter === 440 &&
      listTxs1[0]?.type === 'CREDIT' &&
      listTxs1[0]?.amount === 42 &&
      listTxs1[0]?.balanceAfter === 42
    );

    results.push({ test: '1-on-1 Call Billing Deduction & Listener Credit', passed: test1Passed });
    console.log(test1Passed ? '✅ TEST 1 PASSED' : '❌ TEST 1 FAILED');

    // ═════════════════════════════════════════════════════════════════════
    // TEST SUITE 2: LIVE STREAMING ROOM BILLING & DEDUCTION
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('🧪 TEST 2: Live Room Streaming Viewer Billing & Host Credit');
    console.log('───────────────────────────────────────────────────────────────');

    const liveRoom = await LiveRoom.create({
      hostId: listener._id,
      title: 'Live Test Room',
      mode: 'VIDEO',
      status: 'live',
      liveRate: 15, // 15 coins/min
      earningPercent: 70,
      totalCoinsCollected: 0,
      totalCoinsEarned: 0
    });

    const joinTime = new Date(Date.now() - 2 * 60 * 1000); // Joined 2 mins ago
    const cachedBillingData = {
      joinedAt: joinTime.toISOString(),
      lastBilledAt: joinTime.toISOString(),
      coinsCharged: '0',
      liveRate: '15',
      earningPercent: '70',
      hostId: listener._id.toString(),
      roomId: liveRoom._id.toString()
    };

    // Charge 2 minutes (2 * 15 = 30 coins; Host 70% = 21 coins)
    await liveBillingService.billViewer(
      liveRoom._id.toString(),
      customer._id.toString(),
      new Date(),
      true, // final ceil
      cachedBillingData
    );

    const updatedCustWallet2 = await Wallet.findOne({ userId: customer._id });
    const updatedListWallet2 = await Wallet.findOne({ userId: listener._id });
    const updatedListProf2 = await ListenerProfile.findOne({ userId: listener._id });
    const updatedLiveRoom = await LiveRoom.findById(liveRoom._id);
    const custTxs2 = await CoinTransaction.find({ userId: customer._id }).sort({ createdAt: -1 });
    const listTxs2 = await CoinTransaction.find({ userId: listener._id }).sort({ createdAt: -1 });

    console.log(`📊 Test 2 Results:`);
    console.log(`   - Customer Balance: 440 -> ${updatedCustWallet2.coinBalance} (Total Spent: ${updatedCustWallet2.totalSpent}) [Expected: 410, Spent: 90]`);
    console.log(`   - Listener Wallet: 42 -> ${updatedListWallet2.coinBalance} (Total Earned: ${updatedListWallet2.totalEarned}) [Expected: 63, Earned: 63]`);
    console.log(`   - Listener Profile: 42 -> Available: ${updatedListProf2.availableBalance}, Total: ${updatedListProf2.totalEarnings} [Expected: 63]`);
    console.log(`   - Live Room Aggregates: CoinsCollected=${updatedLiveRoom.totalCoinsCollected}, CoinsEarned=${updatedLiveRoom.totalCoinsEarned}`);
    console.log(`   - Viewer CoinTransaction: Type=${custTxs2[0]?.type}, Amount=${custTxs2[0]?.amount}, Ref=${custTxs2[0]?.referenceType}`);
    console.log(`   - Host CoinTransaction: Type=${listTxs2[0]?.type}, Amount=${listTxs2[0]?.amount}, Ref=${listTxs2[0]?.referenceType}`);

    const test2Passed = (
      updatedCustWallet2.coinBalance === 410 &&
      updatedCustWallet2.totalSpent === 90 &&
      updatedListWallet2.coinBalance === 63 &&
      updatedListProf2.availableBalance === 63 &&
      updatedLiveRoom.totalCoinsCollected === 30 &&
      updatedLiveRoom.totalCoinsEarned === 21 &&
      custTxs2[0]?.type === 'DEBIT' &&
      custTxs2[0]?.amount === 30 &&
      custTxs2[0]?.referenceType === 'LIVE_ROOM' &&
      listTxs2[0]?.type === 'CREDIT' &&
      listTxs2[0]?.amount === 21 &&
      listTxs2[0]?.referenceType === 'LIVE_ROOM'
    );

    results.push({ test: 'Live Streaming Room Billing & Host Credit', passed: test2Passed });
    console.log(test2Passed ? '✅ TEST 2 PASSED' : '❌ TEST 2 FAILED');

    // ═════════════════════════════════════════════════════════════════════
    // TEST SUITE 3: VIRTUAL GIFT SENDING & DEDUCTION
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('🧪 TEST 3: Virtual Gift Sending (Customer debited, Listener credited)');
    console.log('───────────────────────────────────────────────────────────────');

    const testGift = await Gift.create({
      name: 'Rose Bouquet',
      coin: 50,
      earningPercent: 70,
      adminPercent: 30,
      category: 'Romantic',
      isActive: true
    });

    // Customer sends gift (50 coins -> Listener gets 35 coins, Admin gets 15 coins)
    await giftService.sendGift(customer._id, 'CUSTOMER', {
      giftId: testGift._id.toString(),
      receiverId: listener._id.toString()
    });

    const updatedCustWallet3 = await Wallet.findOne({ userId: customer._id });
    const updatedListWallet3 = await Wallet.findOne({ userId: listener._id });
    const updatedListProf3 = await ListenerProfile.findOne({ userId: listener._id });
    const giftTx = await GiftTransaction.findOne({ giftId: testGift._id });
    const custTxs3 = await CoinTransaction.find({ userId: customer._id }).sort({ createdAt: -1 });
    const listTxs3 = await CoinTransaction.find({ userId: listener._id }).sort({ createdAt: -1 });

    console.log(`📊 Test 3 Results:`);
    console.log(`   - Customer Balance: 410 -> ${updatedCustWallet3.coinBalance} (Total Spent: ${updatedCustWallet3.totalSpent}) [Expected: 360, Spent: 140]`);
    console.log(`   - Listener Wallet: 63 -> ${updatedListWallet3.coinBalance} (Total Earned: ${updatedListWallet3.totalEarned}) [Expected: 98, Earned: 98]`);
    console.log(`   - Listener Profile: 63 -> Available: ${updatedListProf3.availableBalance}, Total: ${updatedListProf3.totalEarnings}, Gifts: ${updatedListProf3.giftsReceivedCount}`);
    console.log(`   - Gift Transaction: Status=${giftTx?.status}, Coins=${giftTx?.coins}, EarningCoins=${giftTx?.earningCoins}`);
    console.log(`   - Customer CoinTransaction: Type=${custTxs3[0]?.type}, Amount=${custTxs3[0]?.amount}, Ref=${custTxs3[0]?.referenceType}`);
    console.log(`   - Listener CoinTransaction: Type=${listTxs3[0]?.type}, Amount=${listTxs3[0]?.amount}, Ref=${listTxs3[0]?.referenceType}`);

    const test3Passed = (
      updatedCustWallet3.coinBalance === 360 &&
      updatedCustWallet3.totalSpent === 140 &&
      updatedListWallet3.coinBalance === 98 &&
      updatedListProf3.availableBalance === 98 &&
      updatedListProf3.giftsReceivedCount >= 1 &&
      giftTx?.status === 'SUCCESS' &&
      custTxs3[0]?.type === 'DEBIT' &&
      custTxs3[0]?.amount === 50 &&
      custTxs3[0]?.referenceType === 'GIFT' &&
      listTxs3[0]?.type === 'CREDIT' &&
      listTxs3[0]?.amount === 35 &&
      listTxs3[0]?.referenceType === 'GIFT'
    );

    results.push({ test: 'Virtual Gift Deduction & Listener Wallet Credit', passed: test3Passed });
    console.log(test3Passed ? '✅ TEST 3 PASSED' : '❌ TEST 3 FAILED');

    // ═════════════════════════════════════════════════════════════════════
    // TEST SUITE 4: INSUFFICIENT BALANCE & PARTIAL DEDUCTION EDGE CASE
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('🧪 TEST 4: Low Balance Edge Case (User only has 10 coins, billed for 30)');
    console.log('───────────────────────────────────────────────────────────────');

    // Drain customer balance to exactly 10 coins
    await Wallet.updateOne({ userId: customer._id }, { $set: { coinBalance: 10 } });

    const lowBalanceSession = await CommunicationSession.create({
      callerId: customer._id,
      listenerId: listener._id,
      mode: 'AUDIO',
      status: 'ONGOING',
      startTime: new Date(Date.now() - 3 * 60 * 1000)
    });

    const lowBalanceSegment = await SessionSegment.create({
      sessionId: lowBalanceSession._id,
      mode: 'AUDIO',
      ratePerMinute: 10, // 3 mins * 10 = 30 coins should be charged, but user only has 10!
      status: 'ONGOING',
      coinsCharged: 0,
      startedAt: new Date(Date.now() - 3 * 60 * 1000)
    });

    if (redisClient.isRedisAvailable) {
      await redisClient.hset(`active_session:${lowBalanceSession._id}`, {
        callerId: customer._id.toString(),
        listenerId: listener._id.toString(),
        ratePerMinute: '10',
        startTime: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        lastBilledAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        segmentId: lowBalanceSegment._id.toString()
      });
    }

    await billingService.billSession(lowBalanceSession._id.toString(), new Date(), true);

    const updatedCustWallet4 = await Wallet.findOne({ userId: customer._id });
    const updatedListWallet4 = await Wallet.findOne({ userId: listener._id });
    const custTxs4 = await CoinTransaction.find({ userId: customer._id }).sort({ createdAt: -1 });

    console.log(`📊 Test 4 Results:`);
    console.log(`   - Customer Balance: 10 -> ${updatedCustWallet4.coinBalance} [Expected: 0]`);
    console.log(`   - Actual Deducted: ${custTxs4[0]?.amount} coins (charged only what was left in wallet)`);
    console.log(`   - Listener Received: 70% of 10 = 7 coins (Balance now: ${updatedListWallet4.coinBalance})`);

    const test4Passed = (
      updatedCustWallet4.coinBalance === 0 &&
      custTxs4[0]?.amount === 10 &&
      custTxs4[0]?.type === 'DEBIT' &&
      custTxs4[0]?.balanceAfter === 0
    );

    results.push({ test: 'Low Balance Safe Clamping & Depletion', passed: test4Passed });
    console.log(test4Passed ? '✅ TEST 4 PASSED' : '❌ TEST 4 FAILED');

    // ═════════════════════════════════════════════════════════════════════
    // TEST SUITE 5: IDEMPOTENCY / NO DOUBLE DEDUCTION
    // ═════════════════════════════════════════════════════════════════════
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('🧪 TEST 5: Idempotency (Billing already processed session again)');
    console.log('───────────────────────────────────────────────────────────────');

    const balanceBeforeRepeat = (await Wallet.findOne({ userId: customer._id })).coinBalance;
    const txCountBefore = await CoinTransaction.countDocuments({ userId: customer._id });

    // Call billSession again with same time point
    await billingService.billSession(callSession._id.toString(), billTimePoint, false);

    const balanceAfterRepeat = (await Wallet.findOne({ userId: customer._id })).coinBalance;
    const txCountAfter = await CoinTransaction.countDocuments({ userId: customer._id });

    console.log(`📊 Test 5 Results:`);
    console.log(`   - Balance Before Repeat: ${balanceBeforeRepeat}, After Repeat: ${balanceAfterRepeat}`);
    console.log(`   - Transaction Count Before: ${txCountBefore}, After: ${txCountAfter}`);

    const test5Passed = (
      balanceBeforeRepeat === balanceAfterRepeat &&
      txCountBefore === txCountAfter
    );

    results.push({ test: 'Billing Idempotency Guard (No double charges)', passed: test5Passed });
    console.log(test5Passed ? '✅ TEST 5 PASSED' : '❌ TEST 5 FAILED');

  } finally {
    // Clean up test data
    console.log('\n🧹 Cleaning up test artifacts...');
    await Promise.all([
      User.deleteOne({ _id: customer._id }),
      User.deleteOne({ _id: listener._id }),
      Wallet.deleteMany({ userId: { $in: [customer._id, listener._id] } }),
      ListenerProfile.deleteMany({ userId: listener._id }),
      CoinTransaction.deleteMany({ userId: { $in: [customer._id, listener._id] } }),
      CommunicationSession.deleteMany({ callerId: customer._id }),
      SessionSegment.deleteMany({ sessionId: { $in: [customer._id, listener._id] } }),
      LiveRoom.deleteMany({ hostId: listener._id }),
      GiftTransaction.deleteMany({ senderId: customer._id })
    ]);
    console.log('✅ Clean up completed.');
    await mongoose.disconnect();
  }

  console.log('\n===============================================================');
  console.log('📋 FINAL LIVE TESTING SUMMARY');
  console.log('===============================================================');
  let allPassed = true;
  for (const r of results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.test}`);
    if (!r.passed) allPassed = false;
  }
  console.log('===============================================================');
  console.log(allPassed ? '🎉 ALL LIVE BILLING & WALLET TESTS PASSED PERFECTLY!' : '⚠️ SOME TESTS FAILED');
  console.log('===============================================================\n');
}

runLiveBillingVerification().catch((err) => {
  console.error('❌ Test execution failed with error:', err);
  process.exit(1);
});
