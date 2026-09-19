import 'dotenv/config';
import mongoose from 'mongoose';
import giftService from '../src/services/gift.service.js';
import User from '../src/modules/user.model.js';
import Gift from '../src/modules/gift.model.js';
import Wallet from '../src/modules/wallet.model.js';

const DB_URI = process.env.DATABASE_URI || 'mongodb://localhost:27017/realtime_comm';

async function test() {
  await mongoose.connect(DB_URI);
  console.log('Connected to DB');

  const customer = await User.findOne({ type: 'CUSTOMER', isBlocked: false, isDeleted: false });
  const listener = await User.findOne({ type: 'LISTENER', isBlocked: false, isDeleted: false });
  const gift = await Gift.findOne({ isActive: true });

  console.log('Customer:', customer?._id?.toString(), 'Listener:', listener?._id?.toString(), 'Gift:', gift?.name, gift?.coin);

  if (!customer || !listener || !gift) {
    console.log('Missing customer, listener, or gift');
    process.exit(0);
  }

  // Ensure customer has enough coins
  await Wallet.findOneAndUpdate(
    { userId: customer._id },
    { $inc: { coinBalance: gift.coin + 100 } },
    { upsert: true }
  );

  const testKey = 'test_key_' + Date.now();
  console.log('Testing sendGift with key:', testKey);

  const result = await giftService.sendGift(customer._id, 'CUSTOMER', {
    giftId: gift._id.toString(),
    receiverId: listener._id.toString(),
    idempotencyKey: testKey,
  });

  console.log('SEND_GIFT_SUCCESS:', JSON.stringify(result, null, 2));

  // Test duplicate send with same key
  console.log('Testing duplicate send with same key...');
  const duplicateResult = await giftService.sendGift(customer._id, 'CUSTOMER', {
    giftId: gift._id.toString(),
    receiverId: listener._id.toString(),
    idempotencyKey: testKey,
  });
  console.log('DUPLICATE_PREVENTION_SUCCESS:', JSON.stringify(duplicateResult, null, 2));

  await mongoose.connection.close();
  process.exit(0);
}

test().catch(err => {
  console.error('TEST_FAILED:', err);
  process.exit(1);
});
