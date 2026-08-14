/**
 * One-off data fill: Company.policies from Chat Corner Host & Agency Policy Handbook v1.0 (MKDF).
 * Does not change app runtime code — only writes MongoDB (+ clears Redis company:profile if available).
 *
 * Usage: node scripts/fill-company-policies.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const PROFILE_CACHE_KEY = 'company:profile';

const LISTENER_TERMS = `CHAT CORNER — Official Host & Agency Policy Handbook
Version 1.0 | Approved by Maa Kali Digital Firm (MKDF)

1. Welcome
Chat Corner is an Audio Call, Video Call, Match Call and Public Live Broadcast platform. All Hosts and Agencies must follow platform rules and maintain a professional environment.

2. Host Eligibility
• Host must be 18 years or older.
• All hosts must follow platform rules and management instructions.

3. Host Earning Policy
1,00,000 Coins = ₹1,050

Earning Type | Coin Rate | Approx Amount
Video Call | 1000 Coins/Minute | ₹10.50 per minute
Audio Call | 500 Coins/Minute | ₹5.25 per minute
Match Call | 300 Coins/Minute | ₹3.15 per minute
Gift Share | 80% | Host gets 80% gift share

4. Salary Sheet
Coins | Amount
1,00,000 Coins | ₹1,050
2,00,000 Coins | ₹2,100
5,00,000 Coins | ₹5,250
10,00,000 Coins | ₹10,500
15,00,000 Coins | ₹15,750
20,00,000 Coins | ₹21,000
25,00,000 Coins | ₹26,250
30,00,000 Coins | ₹31,500
40,00,000 Coins | ₹42,000
50,00,000 Coins | ₹52,500
75,00,000 Coins | ₹78,750
1,00,00,000 Coins | ₹1,05,000

5. Withdrawal Policy
• Self Withdrawal Available.
• Minimum Withdrawal: 1,00,000 Coins (₹1,050).
• 2% Service Charge on every withdrawal.
• Processing Time: 1-3 Working Days.
• If earnings are below minimum withdrawal, balance will be carried forward to next week.
• New Week Starts Every Monday at 12:00 AM.

6. General Host Rules
• Maintain professional behavior.
• Respect users and platform reputation.
• Do not end calls unnecessarily.
• Fraud, fake activity and earning manipulation are prohibited.
• Management instructions must be followed.

7. Temporary Ban Rules
1. Face not visible during Live or Video Call: ID may be banned for 3 to 12 hours.
2. Sleeping or lying down during Live or Call: ID may be banned for 3 to 12 hours.
3. Outdoor walking during Live or Call: ID may be banned for 3 to 12 hours.
4. Low light or dark environment during Live or Call: ID may be banned for 7 hours.

8. Permanent Ban Rules
1. Showing small children during Live or Call may result in permanent ban.
2. Pornographic content may result in permanent ban.
3. Running multiple IDs may result in action against all related IDs.
4. Sharing Phone Number, WhatsApp, Telegram, Instagram, Facebook or personal contact details may result in permanent ban.
5. Private money transactions outside the platform may result in permanent ban.

9. Agency Policy (for reference)
Earning Range | Agency Commission
₹0 - ₹10,000 | 5% Commission
₹10,000 - ₹15,000 | 7% Commission
₹15,000 - ₹25,000 | 10% Commission
₹25,000 - ₹40,000 | 12% Commission
₹40,000 - ₹60,000 and above | 15% Commission
Agency Payment Day: Tuesday

10. Agency Responsibilities (for reference)
• Recruit new hosts.
• Provide host support and training.
• Monitor host performance.
• Ensure policy compliance.

11. Host Success Formula
• Stay active daily.
• Avoid ending calls quickly.
• Increase user engagement.
• Focus on gifts and long conversations.
• Maintain a professional profile.
• Build repeat users.

12. Top Host Habits
• Consistency.
• Professional behavior.
• Positive attitude.
• High activity.
• Following platform rules.
• Long quality calls.

13. Final Reminder
• Follow all platform rules.
• Do not share personal information.
• Do not make private deals with users.
• Maintain professionalism at all times.

14. Important Warning
Pornographic content, child safety violations, multiple IDs, personal contact sharing, private money transactions and serious fraud activities may lead to strict action including permanent ban.

15. Important Notice
• If any host violates platform rules, any resulting issue shall be the responsibility of the host.
• Company and agency will not be responsible.
• Management decision will be considered final.
• Chat Corner Management reserves the right to modify rates, commissions, policies and procedures whenever required.

16. Official Approval
CHAT CORNER OFFICIAL HOST & AGENCY HANDBOOK
Version 1.0
Approved by Maa Kali Digital Firm (MKDF)
Building Professional Hosts & Strong Agencies`;

const LISTENER_REFUND = `5. Withdrawal Policy (Chat Corner Host Handbook v1.0)

• Self Withdrawal Available.
• Minimum Withdrawal: 1,00,000 Coins (₹1,050).
• 2% Service Charge on every withdrawal.
• Processing Time: 1-3 Working Days.
• If earnings are below minimum withdrawal, balance will be carried forward to next week.
• New Week Starts Every Monday at 12:00 AM.

Reference rate: 1,00,000 Coins = ₹1,050.

Chat Corner Management reserves the right to modify rates, commissions, policies and procedures whenever required. Management decision will be considered final.`;

const LISTENER_PRIVACY = `Host Privacy & Personal Information Rules (Chat Corner Handbook v1.0)

• Do not share Phone Number, WhatsApp, Telegram, Instagram, Facebook or any personal contact details. Doing so may result in permanent ban.
• Do not make private deals with users.
• Private money transactions outside the platform may result in permanent ban.
• Showing small children during Live or Call may result in permanent ban.
• Pornographic content may result in permanent ban.
• Running multiple IDs may result in action against all related IDs.
• Follow all platform rules and maintain professionalism at all times.

Important Warning:
Pornographic content, child safety violations, multiple IDs, personal contact sharing, private money transactions and serious fraud activities may lead to strict action including permanent ban.

If any host violates platform rules, any resulting issue shall be the responsibility of the host. Company and agency will not be responsible.`;

const AGENT_TERMS = `CHAT CORNER — Agency Policy (Host & Agency Handbook v1.0)
Approved by Maa Kali Digital Firm (MKDF)

9. Agency Policy
Earning Range | Agency Commission
₹0 - ₹10,000 | 5% Commission
₹10,000 - ₹15,000 | 7% Commission
₹15,000 - ₹25,000 | 10% Commission
₹25,000 - ₹40,000 | 12% Commission
₹40,000 - ₹60,000 and above | 15% Commission
Agency Payment Day: Tuesday

10. Agency Responsibilities
• Recruit new hosts.
• Provide host support and training.
• Monitor host performance.
• Ensure policy compliance.

Host handbook context (agencies must ensure hosts follow these rules):
• Hosts must be 18+.
• Maintain professional behavior; fraud and earning manipulation are prohibited.
• Temporary bans may apply for face not visible, sleeping/lying down, outdoor walking (3–12 hours), or low light (7 hours).
• Permanent ban may apply for: children on Live/Call, pornographic content, multiple IDs, sharing personal contacts, or private money transactions off-platform.

13. Final Reminder
• Follow all platform rules.
• Do not share personal information.
• Do not make private deals with users.
• Maintain professionalism at all times.

14. Important Warning
Pornographic content, child safety violations, multiple IDs, personal contact sharing, private money transactions and serious fraud activities may lead to strict action including permanent ban.

15. Important Notice
• If any host violates platform rules, any resulting issue shall be the responsibility of the host.
• Company and agency will not be responsible.
• Management decision will be considered final.
• Chat Corner Management reserves the right to modify rates, commissions, policies and procedures whenever required.

16. Official Approval
CHAT CORNER OFFICIAL HOST & AGENCY HANDBOOK — Version 1.0
Approved by Maa Kali Digital Firm (MKDF)
Building Professional Hosts & Strong Agencies`;

const AGENT_PRIVACY = `Agency Privacy & Contact Rules (Chat Corner Handbook v1.0)

Agencies must ensure hosts and agency staff comply with:

• Do not share Phone Number, WhatsApp, Telegram, Instagram, Facebook or personal contact details. Violation may result in permanent ban.
• Do not make private deals with users.
• Private money transactions outside the platform may result in permanent ban.
• Child safety violations and pornographic content may result in permanent ban.
• Running multiple IDs may result in action against all related IDs.

Important Warning:
Pornographic content, child safety violations, multiple IDs, personal contact sharing, private money transactions and serious fraud activities may lead to strict action including permanent ban.

Management decision will be considered final. Company and agency will not be responsible for issues arising from host rule violations.`;

const APP_TERMS = `Chat Corner — Terms for Users (from Official Handbook v1.0)

1. Welcome
Chat Corner is an Audio Call, Video Call, Match Call and Public Live Broadcast platform. Users and hosts must maintain a professional environment and follow platform rules.

14. Important Warning
Pornographic content, child safety violations, multiple IDs, personal contact sharing, private money transactions and serious fraud activities may lead to strict action including permanent ban.

15. Important Notice
• Violations of platform rules are the responsibility of the violating party.
• Company and agency will not be responsible.
• Management decision will be considered final.
• Chat Corner Management reserves the right to modify rates, commissions, policies and procedures whenever required.

Official Approval: Chat Corner Official Host & Agency Handbook Version 1.0 — Approved by Maa Kali Digital Firm (MKDF).`;

const APP_PRIVACY = `Chat Corner — Privacy & Safety (from Official Handbook v1.0)

• Do not share Phone Number, WhatsApp, Telegram, Instagram, Facebook or personal contact details on the platform.
• Do not make private deals or money transactions outside the platform.
• Child safety: showing small children during Live or Call is prohibited and may result in permanent ban.
• Pornographic content is prohibited and may result in permanent ban.
• Maintain professionalism and respect other users and the platform reputation.

Serious violations may lead to strict action including permanent ban. Management decision is final.`;

const APP_REFUND = `Chat Corner — Purchases & Platform Decisions (from Official Handbook v1.0, §15)

• Chat Corner Management reserves the right to modify rates, commissions, policies and procedures whenever required.
• Management decision will be considered final.
• Host withdrawal terms (minimum coins, service charge, weekly cycle) in the Host Handbook apply to hosts/listeners, not to customer coin purchases.
• Company and agency will not be responsible for issues arising from rule violations by hosts or users.

For purchase or wallet concerns, contact Chat Corner support via the in-app Help section.`;

const ABOUT_US = `Chat Corner

Chat Corner is an Audio Call, Video Call, Match Call and Public Live Broadcast platform. All Hosts and Agencies must follow platform rules and maintain a professional environment.

Official Approval
CHAT CORNER OFFICIAL HOST & AGENCY HANDBOOK
Version 1.0
Approved by Maa Kali Digital Firm (MKDF)
Building Professional Hosts & Strong Agencies`;

const CONTACT_US_FALLBACK =
  'Contact Chat Corner support via the in-app Help section, or contact your Agency for host/agency related queries.';

async function clearProfileCache() {
  const host = process.env.REDIS_HOST;
  if (!host) {
    console.log('REDIS_HOST not set — skip cache clear');
    return;
  }
  let redis;
  try {
    redis = new Redis({
      host,
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    const n = await redis.del(PROFILE_CACHE_KEY);
    console.log(`Redis: deleted ${PROFILE_CACHE_KEY} (keys removed: ${n})`);
  } catch (err) {
    console.warn('Redis cache clear skipped:', err.message);
  } finally {
    if (redis) {
      try {
        await redis.quit();
      } catch {
        /* ignore */
      }
    }
  }
}

async function main() {
  const uri = process.env.DATABASE_URI || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('DATABASE_URI not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const companies = mongoose.connection.collection('companies');
  const existing = await companies.find({}).sort({ createdAt: -1 }).limit(1).next();

  const policies = {
    app: {
      privacyPolicy: APP_PRIVACY,
      termsAndConditions: APP_TERMS,
      refundPolicy: APP_REFUND,
    },
    listener: {
      privacyPolicy: LISTENER_PRIVACY,
      termsAndConditions: LISTENER_TERMS,
      refundPolicy: LISTENER_REFUND,
    },
    agent: {
      privacyPolicy: AGENT_PRIVACY,
      termsAndConditions: AGENT_TERMS,
    },
    aboutUs: ABOUT_US,
    contactUs:
      existing?.policies?.contactUs && String(existing.policies.contactUs).trim()
        ? existing.policies.contactUs
        : CONTACT_US_FALLBACK,
    // clear legacy flat keys
    privacyPolicy: '',
    termsAndConditions: '',
    refundPolicy: '',
  };

  let result;
  if (existing) {
    result = await companies.updateOne({ _id: existing._id }, { $set: { policies, updatedAt: new Date() } });
    console.log(`Updated company ${existing._id} (matched=${result.matchedCount}, modified=${result.modifiedCount})`);
  } else {
    const now = new Date();
    const insert = await companies.insertOne({
      name: 'Chat Corner',
      email: 'info@company.com',
      description: 'Chat Corner audio, video, match call and live broadcast platform.',
      policies,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Created company ${insert.insertedId}`);
  }

  await clearProfileCache();
  await mongoose.disconnect();
  console.log('Done — policies filled from Host & Agency Handbook v1.0');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
