import Reward from '../modules/reward.model.js';
import LevelConfig from '../modules/level-config.model.js';
import XpConfig from '../modules/xp-config.model.js';
import Avatar from '../modules/avatar.model.js';
import logger from '../utils/logger.util.js';

/**
 * Idempotent seeder for XP & Level system.
 * Safe to call on every server boot — only creates docs that don't exist.
 *
 * Seeding order:
 * 1. Reward docs (coins, avatars, badges)
 * 2. LevelConfig docs (referencing reward IDs)
 * 3. XpConfig docs (XP values per action)
 */
export const seedXpSystem = async () => {
  try {
    // Skip if already seeded (check if any LevelConfig exists)
    const existingLevels = await LevelConfig.countDocuments();
    if (existingLevels > 0) {
      return; // Already seeded — skip silently
    }

    logger.info('[XP Seeder] Seeding XP & Level system defaults...');

    // ═══════════════════════════════════════════════════════════════
    // Step 1: Create Reward docs
    // ═══════════════════════════════════════════════════════════════

    // Coin rewards
    const coinRewardValues = [50, 100, 150, 250, 500, 750, 1000, 1500, 2000];
    const coinRewards = {};

    for (const coins of coinRewardValues) {
      const reward = await Reward.create({
        type: 'COINS',
        value: coins,
        label: `${coins} Bonus Coins`,
        isActive: true,
      });
      coinRewards[coins] = reward._id;
      logger.info(`[XP Seeder] Created reward: ${coins} Bonus Coins`);
    }

    // Avatar rewards — lookup existing avatars by name
    const avatarNames = ['Cyber Ninja', 'Mystic Sorcerer', 'Golden Monarch'];
    const avatarRewards = {};

    for (const name of avatarNames) {
      const avatar = await Avatar.findOne({ name });
      if (avatar) {
        const reward = await Reward.create({
          type: 'AVATAR',
          value: 1,
          referenceId: avatar._id,
          label: `${name} Avatar`,
          icon: avatar.image,
          isActive: true,
        });
        avatarRewards[name] = reward._id;
        logger.info(`[XP Seeder] Created reward: ${name} Avatar`);
      } else {
        logger.warn(`[XP Seeder] Avatar "${name}" not found — skipping reward`);
      }
    }

    // Badge reward
    const goldBadgeReward = await Reward.create({
      type: 'BADGE',
      value: 1,
      label: 'Gold Badge',
      icon: 'https://cdn-icons-png.flaticon.com/512/2583/2583344.png',
      isActive: true,
    });
    logger.info('[XP Seeder] Created reward: Gold Badge');

    // ═══════════════════════════════════════════════════════════════
    // Step 2: Create LevelConfig docs
    // ═══════════════════════════════════════════════════════════════

    const levelConfigs = [
      { level: 1, xpRequired: 0, title: 'Newcomer', rewards: [] },
      { level: 2, xpRequired: 100, title: 'Explorer', rewards: [coinRewards[50]] },
      { level: 3, xpRequired: 250, title: 'Chatter', rewards: [coinRewards[100]] },
      {
        level: 4, xpRequired: 500, title: 'Regular',
        rewards: [coinRewards[150], avatarRewards['Cyber Ninja']].filter(Boolean),
      },
      { level: 5, xpRequired: 1000, title: 'Adventurer', rewards: [coinRewards[250]] },
      { level: 6, xpRequired: 2000, title: 'Super Fan', rewards: [coinRewards[500]] },
      {
        level: 7, xpRequired: 3500, title: 'Elite',
        rewards: [coinRewards[750], avatarRewards['Mystic Sorcerer']].filter(Boolean),
      },
      { level: 8, xpRequired: 5500, title: 'Legend', rewards: [coinRewards[1000]] },
      { level: 9, xpRequired: 8000, title: 'Master', rewards: [coinRewards[1500]] },
      {
        level: 10, xpRequired: 11000, title: 'Grand Master',
        rewards: [
          coinRewards[2000],
          avatarRewards['Golden Monarch'],
          goldBadgeReward._id,
        ].filter(Boolean),
      },
    ];

    for (const config of levelConfigs) {
      await LevelConfig.create(config);
      logger.info(`[XP Seeder] Created level ${config.level}: ${config.title} (${config.xpRequired} XP)`);
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 3: Create XpConfig docs
    // ═══════════════════════════════════════════════════════════════

    const xpActions = [
      { action: 'DAILY_LOGIN', xp: 10, label: 'Daily Login' },
      { action: 'CHAT_MESSAGE', xp: 2, label: 'Send Chat Message' },
      { action: 'VOICE_CALL', xp: 30, label: 'Complete Voice Call Session' },
      { action: 'VIDEO_CALL', xp: 50, label: 'Complete Video Call Session' },
      { action: 'PROFILE_COMPLETE', xp: 100, label: 'Complete Profile (one-time)' },
      { action: 'GIFT_SENT', xp: 20, label: 'Send a Gift' },
      { action: 'DAILY_STREAK_BONUS', xp: 15, label: 'Daily Streak Bonus' },
      { action: 'AVATAR_UNLOCK', xp: 10, label: 'Unlock a Paid Avatar' },
      { action: 'FIRST_CALL', xp: 50, label: 'First Ever Call (one-time)' },
      { action: 'FOLLOW_USER', xp: 5, label: 'Follow a User' },
    ];

    for (const xpAction of xpActions) {
      const existing = await XpConfig.findOne({ action: xpAction.action });
      if (!existing) {
        await XpConfig.create(xpAction);
        logger.info(`[XP Seeder] Created XP action: ${xpAction.action} = ${xpAction.xp} XP`);
      }
    }

    logger.info('[XP Seeder] ✅ XP & Level system seeding completed successfully!');
  } catch (err) {
    logger.error(`[XP Seeder Error] ${err.message}`);
  }
};
