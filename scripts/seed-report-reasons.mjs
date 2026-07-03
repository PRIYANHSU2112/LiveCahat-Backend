/**
 * Seed default report reasons. Safe to run multiple times (skips existing labels).
 * Usage: node scripts/seed-report-reasons.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ReportReason from '../src/modules/report-reason.model.js';

dotenv.config();

const DEFAULT_REASONS = [
  { label: 'Harassment', description: 'Threatening, bullying, or abusive behavior', sortOrder: 1 },
  { label: 'Spam', description: 'Unsolicited or repetitive messages', sortOrder: 2 },
  { label: 'Inappropriate content', description: 'Sexual, violent, or otherwise inappropriate content', sortOrder: 3 },
  { label: 'Fraud or scam', description: 'Attempts to deceive or solicit money', sortOrder: 4 },
  { label: 'Abusive behavior', description: 'Verbal abuse or hate speech', sortOrder: 5 },
  { label: 'Fake profile', description: 'Misleading identity or impersonation', sortOrder: 6 },
  { label: 'Other', description: 'Other concerns not listed above', sortOrder: 99 },
];

async function seed() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  let created = 0;
  let skipped = 0;

  for (const reason of DEFAULT_REASONS) {
    const exists = await ReportReason.findOne({ label: reason.label }).lean();
    if (exists) {
      skipped++;
      continue;
    }
    await ReportReason.create(reason);
    created++;
  }

  console.log(`Done: ${created} created, ${skipped} skipped`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
