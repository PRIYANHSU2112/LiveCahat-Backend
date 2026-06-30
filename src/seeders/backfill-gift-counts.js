/**
 * ONE-TIME BACKFILL — populate listenerProfile.giftsReceivedCount from existing
 * successful gift transactions. Run manually once after deploying the gift counter:
 *
 *   node src/seeders/backfill-gift-counts.js
 *
 * Safe to re-run: it recomputes counts from source data and overwrites.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import GiftTransaction from '../modules/gift-transaction.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import logger from '../utils/logger.util.js';

dotenv.config();

const backfillGiftCounts = async () => {
  await mongoose.connect(process.env.DATABASE_URI);
  logger.info('[Gift Backfill] Connected. Aggregating gift counts per listener...');

  // Count successful listener-bound gifts grouped by receiver.
  const counts = await GiftTransaction.aggregate([
    {
      $match: {
        type: { $in: ['USER_TO_LISTENER', 'ADMIN_TO_LISTENER'] },
        status: 'SUCCESS',
      },
    },
    { $group: { _id: '$receiverId', count: { $sum: 1 } } },
  ]);

  // Reset everyone to 0 first so listeners with no gifts are corrected too.
  await ListenerProfile.updateMany({}, { $set: { giftsReceivedCount: 0 } });

  const ops = counts.map(({ _id, count }) => ({
    updateOne: {
      filter: { userId: _id },
      update: { $set: { giftsReceivedCount: count } },
    },
  }));

  if (ops.length) {
    const res = await ListenerProfile.bulkWrite(ops);
    logger.info(`[Gift Backfill] Updated ${res.modifiedCount} listener profiles.`);
  } else {
    logger.info('[Gift Backfill] No gift transactions found — all counts set to 0.');
  }

  await mongoose.disconnect();
  logger.info('[Gift Backfill] ✅ Done.');
};

backfillGiftCounts().catch((err) => {
  logger.error(`[Gift Backfill Error] ${err.message}`);
  process.exit(1);
});




