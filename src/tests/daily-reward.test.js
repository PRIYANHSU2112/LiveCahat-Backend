import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import dailyRewardService from '../services/daily-reward.service.js';
import User from '../modules/user.model.js';
import Wallet from '../modules/wallet.model.js';
import DailyRewardState from '../modules/daily-reward-state.model.js';
import DailyRewardClaimLog from '../modules/daily-reward-claim-log.model.js';
import UserGiftInventory from '../modules/user-gift-inventory.model.js';
import Gift from '../modules/gift.model.js';
import redisClient, { pubClient, subClient } from '../config/redis.js';

// Set higher timeout for tests in slower environments
jest.setTimeout(60000);

describe('Daily Login Reward System', () => {
  let testUser;

  beforeAll(async () => {
    const DB_URI = process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017/realtime_comm_test';
    // If not connected, connect
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(DB_URI);
    }
    // Seed configs
    await dailyRewardService.seedDefaultConfig();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      if (mongoose.connection.db) {
        try {
          await mongoose.connection.db.dropDatabase();
        } catch (err) {
          // ignore drop errors
        }
      }
      await mongoose.connection.close();
    }
    // Disconnect Redis so Jest doesn't hang
    try {
      await redisClient.disconnect();
      await pubClient.disconnect();
      await subClient.disconnect();
    } catch (err) {
      // ignore redis disconnect errors
    }
  });

  beforeEach(async () => {
    // Clean collections
    await User.deleteMany({});
    await Wallet.deleteMany({});
    await DailyRewardState.deleteMany({});
    await DailyRewardClaimLog.deleteMany({});
    await UserGiftInventory.deleteMany({});

    // Create a test customer
    testUser = await User.create({
      firstName: 'John',
      lastName: 'Doe',
      type: 'CUSTOMER',
      email: 'john@example.com',
      profileCompleted: true
    });
  });

  it('should successfully claim rewards sequentially from Day 1 to Day 7', async () => {
    // Let's claim Day 1 on Monday
    const date1 = '2026-06-01T12:00:00Z'; // Monday
    const res1 = await dailyRewardService.claimDailyReward(testUser._id, date1);
    expect(res1.claimedDay).toBe(1);
    expect(res1.reward.type).toBe('COINS');
    expect(res1.reward.value).toBe(100);

    // Verify wallet
    const wallet1 = await Wallet.findOne({ userId: testUser._id });
    expect(wallet1.coinBalance).toBe(100);

    // Day 2 on Tuesday (consecutive)
    const date2 = '2026-06-02T12:00:00Z'; // Tuesday
    const res2 = await dailyRewardService.claimDailyReward(testUser._id, date2);
    expect(res2.claimedDay).toBe(2);
    expect(res2.reward.value).toBe(110);

    const wallet2 = await Wallet.findOne({ userId: testUser._id });
    expect(wallet2.coinBalance).toBe(210);

    // Day 3 to 6
    let expectedCoins = 210;
    for (let day = 3; day <= 6; day++) {
      const claimDate = `2026-06-0${day}T12:00:00Z`;
      const res = await dailyRewardService.claimDailyReward(testUser._id, claimDate);
      expect(res.claimedDay).toBe(day);
      expectedCoins += 100 + (day - 1) * 10;
      const wallet = await Wallet.findOne({ userId: testUser._id });
      expect(wallet.coinBalance).toBe(expectedCoins);
    }

    // Day 7 on Sunday - Weekly Special Gift!
    const date7 = '2026-06-07T12:00:00Z'; // Sunday
    const res7 = await dailyRewardService.claimDailyReward(testUser._id, date7);
    expect(res7.claimedDay).toBe(7);
    expect(res7.reward.type).toBe('GIFT');
    expect(res7.reward.value).toBe('Bronze Mystery Chest'); // Week 1 reward
    expect(res7.streakState.specialGiftWeek).toBe(2); // advanced to Week 2!

    // Verify inventory has the chest
    const inventory = await UserGiftInventory.find({ userId: testUser._id }).populate('giftId');
    expect(inventory.length).toBe(1);
    expect(inventory[0].giftId.name).toBe('Bronze Mystery Chest');
  });

  it('should reset streak back to Day 1 if a day is missed', async () => {
    // Claim Day 1 on Monday
    const mon = '2026-06-01T12:00:00Z';
    await dailyRewardService.claimDailyReward(testUser._id, mon);

    // Claim Day 2 on Tuesday
    const tue = '2026-06-02T12:00:00Z';
    const resTue = await dailyRewardService.claimDailyReward(testUser._id, tue);
    expect(resTue.claimedDay).toBe(2);

    // Pause/Skip Wednesday. Log in and claim on Thursday (missed day)
    const thu = '2026-06-04T12:00:00Z';
    const resThu = await dailyRewardService.claimDailyReward(testUser._id, thu);
    // Streak should break and reset back to Day 1!
    expect(resThu.claimedDay).toBe(1);
    expect(resThu.reward.value).toBe(100);

    // Special Gift Week should remain Week 1 (since Day 7 was never completed)
    expect(resThu.streakState.specialGiftWeek).toBe(1);
  });

  it('should reject double claims on the same calendar day (UTC)', async () => {
    const mon = '2026-06-01T12:00:00Z';
    await dailyRewardService.claimDailyReward(testUser._id, mon);

    // Try to claim again on Monday (same UTC calendar day)
    const monLater = '2026-06-01T20:00:00Z';
    await expect(
      dailyRewardService.claimDailyReward(testUser._id, monLater)
    ).rejects.toThrow('Daily reward already claimed today');
  });

  it('should rotate weekly special gifts from Week 1 to 4 and back to Week 1', async () => {
    let currentDate = new Date('2026-06-01T12:00:00Z'); // Day 1 Monday

    const chestsExpected = [
      'Bronze Mystery Chest',
      'Silver Mystery Chest',
      'Gold Mystery Chest',
      'Diamond Mystery Chest',
      'Bronze Mystery Chest'
    ];

    for (let cycle = 0; cycle < 5; cycle++) {
      for (let day = 1; day <= 7; day++) {
        const res = await dailyRewardService.claimDailyReward(testUser._id, currentDate);
        if (day === 7) {
          expect(res.claimedDay).toBe(7);
          expect(res.reward.type).toBe('GIFT');
          expect(res.reward.value).toBe(chestsExpected[cycle]);
        }
        // Advance 1 day
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
    }
  });

  it('should prevent duplicate claims under concurrent operations (race conditions)', async () => {
    const mon = '2026-06-01T12:00:00Z';
    
    // Dispatch 5 concurrent claims for the same user on the same day
    const promises = Array.from({ length: 5 }).map(() =>
      dailyRewardService.claimDailyReward(testUser._id, mon)
    );

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // Exactly 1 claim must succeed, and 4 must fail with duplicate errors
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    // Verify wallet only got credited once
    const wallet = await Wallet.findOne({ userId: testUser._id });
    expect(wallet.coinBalance).toBe(100);
  });
});
