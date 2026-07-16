/**
 * Industry-standard resource.action permission catalog for ADMIN panel RBAC.
 * Role.permissions stores these codes as strings for O(1) authorize checks.
 */

export const PERMISSION_CATALOG = [
  // Dashboard
  { code: 'dashboard.view', module: 'dashboard', action: 'view', description: 'View admin dashboard' },

  // Analytics
  { code: 'analytics.revenue.view', module: 'analytics', action: 'view', description: 'View revenue analytics' },
  { code: 'analytics.users.view', module: 'analytics', action: 'view', description: 'View user analytics' },
  { code: 'analytics.listeners.view', module: 'analytics', action: 'view', description: 'View listener analytics' },
  { code: 'analytics.sessions.view', module: 'analytics', action: 'view', description: 'View session analytics' },

  // Users / staff
  { code: 'user.read', module: 'users', action: 'view', description: 'View users' },
  { code: 'user.stats.view', module: 'users', action: 'view', description: 'View user stats' },
  { code: 'user.activity.view', module: 'users', action: 'view', description: 'View user activity' },
  { code: 'user.block', module: 'users', action: 'approve', description: 'Block/unblock users' },
  { code: 'admin.create', module: 'users', action: 'create', description: 'Create admin users' },
  { code: 'agent.create', module: 'users', action: 'create', description: 'Create agent users' },
  { code: 'agent.commission.update', module: 'users', action: 'edit', description: 'Update agent commission' },
  { code: 'agent.stats.view', module: 'users', action: 'view', description: 'View agent stats' },
  { code: 'search.admin', module: 'users', action: 'view', description: 'Admin global search' },

  // Listeners
  { code: 'listener.read', module: 'listeners', action: 'view', description: 'View listeners' },
  { code: 'listener.create', module: 'listeners', action: 'create', description: 'Create listeners (admin)' },
  { code: 'listener.update', module: 'listeners', action: 'edit', description: 'Update listeners' },
  { code: 'listener.stats.view', module: 'listeners', action: 'view', description: 'View listener stats' },
  { code: 'listener.performance.view', module: 'listeners', action: 'view', description: 'View listener performance' },
  { code: 'listener.availability.view', module: 'listeners', action: 'view', description: 'View availability monitoring' },
  { code: 'listener.kyc.moderate', module: 'listeners', action: 'approve', description: 'Approve/reject KYC' },

  // Communications
  { code: 'communication.session.read', module: 'communications', action: 'view', description: 'View sessions' },
  { code: 'communication.session.force_end', module: 'communications', action: 'edit', description: 'Force-end sessions' },
  { code: 'communication.config.read', module: 'settings', action: 'view', description: 'View communication config' },
  { code: 'communication.config.update', module: 'settings', action: 'edit', description: 'Update communication config' },

  { code: 'platform_settings.read', module: 'settings', action: 'view', description: 'View platform settings' },
  { code: 'platform_settings.update', module: 'settings', action: 'edit', description: 'Update platform settings' },

  { code: 'payment_gateway.read', module: 'settings', action: 'view', description: 'View payment gateways' },
  { code: 'payment_gateway.create', module: 'settings', action: 'create', description: 'Create payment gateways' },
  { code: 'payment_gateway.update', module: 'settings', action: 'edit', description: 'Update payment gateways' },
  { code: 'payment_gateway.delete', module: 'settings', action: 'delete', description: 'Delete payment gateways' },

  // Wallet
  { code: 'wallet.read', module: 'finance', action: 'view', description: 'View wallets' },
  { code: 'wallet.stats.view', module: 'finance', action: 'view', description: 'View wallet stats' },
  { code: 'wallet.transaction.read', module: 'finance', action: 'view', description: 'View transactions' },
  { code: 'wallet.adjust', module: 'finance', action: 'edit', description: 'Credit/debit wallets' },
  { code: 'wallet.status.update', module: 'finance', action: 'edit', description: 'Update wallet status' },

  // Withdrawals / settlements
  { code: 'withdrawal.read', module: 'finance', action: 'view', description: 'View withdrawals' },
  { code: 'withdrawal.stats.view', module: 'finance', action: 'view', description: 'View withdrawal stats' },
  { code: 'withdrawal.config.update', module: 'finance', action: 'edit', description: 'Update withdrawal config' },
  { code: 'withdrawal.approve', module: 'finance', action: 'approve', description: 'Approve withdrawals' },
  { code: 'withdrawal.reject', module: 'finance', action: 'approve', description: 'Reject withdrawals' },
  { code: 'settlement.read', module: 'finance', action: 'view', description: 'View settlements' },
  { code: 'settlement.run', module: 'finance', action: 'approve', description: 'Run settlements' },

  // Moderation
  { code: 'report.read', module: 'moderation', action: 'view', description: 'View reports' },
  { code: 'report.stats.view', module: 'moderation', action: 'view', description: 'View report stats' },
  { code: 'report.moderate', module: 'moderation', action: 'approve', description: 'Moderate reports' },
  { code: 'report_reason.read', module: 'moderation', action: 'view', description: 'View report reasons' },
  { code: 'report_reason.create', module: 'moderation', action: 'create', description: 'Create report reasons' },
  { code: 'report_reason.update', module: 'moderation', action: 'edit', description: 'Update report reasons' },
  { code: 'report_reason.delete', module: 'moderation', action: 'delete', description: 'Delete report reasons' },
  { code: 'feedback.read', module: 'moderation', action: 'view', description: 'View feedback' },
  { code: 'feedback.stats.view', module: 'moderation', action: 'view', description: 'View feedback stats' },
  { code: 'feedback.moderate', module: 'moderation', action: 'approve', description: 'Moderate feedback' },

  // Notifications
  { code: 'notification.send', module: 'notifications', action: 'create', description: 'Send notifications' },
  { code: 'notification.broadcast', module: 'notifications', action: 'create', description: 'Broadcast notifications' },
  { code: 'notification.admin.read', module: 'notifications', action: 'view', description: 'View admin notifications' },
  { code: 'notification.admin.stats.view', module: 'notifications', action: 'view', description: 'View notification stats' },

  // Catalogue CRM
  { code: 'country.read', module: 'settings', action: 'view', description: 'View countries' },
  { code: 'country.create', module: 'settings', action: 'create', description: 'Create countries' },
  { code: 'country.update', module: 'settings', action: 'edit', description: 'Update countries' },
  { code: 'country.delete', module: 'settings', action: 'delete', description: 'Delete countries' },
  { code: 'country.stats.view', module: 'settings', action: 'view', description: 'View country stats' },

  { code: 'company.read', module: 'settings', action: 'view', description: 'View company' },
  { code: 'company.create', module: 'settings', action: 'create', description: 'Create company' },
  { code: 'company.update', module: 'settings', action: 'edit', description: 'Update company' },
  { code: 'company.delete', module: 'settings', action: 'delete', description: 'Delete company' },
  { code: 'company.stats.view', module: 'settings', action: 'view', description: 'View company stats' },

  { code: 'language.read', module: 'settings', action: 'view', description: 'View languages' },
  { code: 'language.create', module: 'settings', action: 'create', description: 'Create languages' },
  { code: 'language.update', module: 'settings', action: 'edit', description: 'Update languages' },
  { code: 'language.delete', module: 'settings', action: 'delete', description: 'Delete languages' },
  { code: 'language.stats.view', module: 'settings', action: 'view', description: 'View language stats' },

  { code: 'coin_pack.read', module: 'finance', action: 'view', description: 'View coin packs' },
  { code: 'coin_pack.create', module: 'finance', action: 'create', description: 'Create coin packs' },
  { code: 'coin_pack.update', module: 'finance', action: 'edit', description: 'Update coin packs' },
  { code: 'coin_pack.delete', module: 'finance', action: 'delete', description: 'Delete coin packs' },
  { code: 'coin_pack.stats.view', module: 'finance', action: 'view', description: 'View coin pack stats' },

  { code: 'gift.read', module: 'finance', action: 'view', description: 'View gifts' },
  { code: 'gift.create', module: 'finance', action: 'create', description: 'Create gifts' },
  { code: 'gift.update', module: 'finance', action: 'edit', description: 'Update gifts' },
  { code: 'gift.delete', module: 'finance', action: 'delete', description: 'Delete gifts' },
  { code: 'gift.stats.view', module: 'finance', action: 'view', description: 'View gift stats' },
  { code: 'gift.analytics.view', module: 'finance', action: 'view', description: 'View gift analytics' },

  { code: 'banner.read', module: 'notifications', action: 'view', description: 'View banners' },
  { code: 'banner.create', module: 'notifications', action: 'create', description: 'Create banners' },
  { code: 'banner.update', module: 'notifications', action: 'edit', description: 'Update banners' },
  { code: 'banner.delete', module: 'notifications', action: 'delete', description: 'Delete banners' },
  { code: 'banner.stats.view', module: 'notifications', action: 'view', description: 'View banner stats' },

  { code: 'avatar.read', module: 'settings', action: 'view', description: 'View avatars' },
  { code: 'avatar.create', module: 'settings', action: 'create', description: 'Create avatars' },
  { code: 'avatar.update', module: 'settings', action: 'edit', description: 'Update avatars' },
  { code: 'avatar.delete', module: 'settings', action: 'delete', description: 'Delete avatars' },
  { code: 'avatar.stats.view', module: 'settings', action: 'view', description: 'View avatar stats' },

  { code: 'sticker.read', module: 'settings', action: 'view', description: 'View stickers' },
  { code: 'sticker.create', module: 'settings', action: 'create', description: 'Create stickers' },
  { code: 'sticker.update', module: 'settings', action: 'edit', description: 'Update stickers' },
  { code: 'sticker.delete', module: 'settings', action: 'delete', description: 'Delete stickers' },
  { code: 'sticker.stats.view', module: 'settings', action: 'view', description: 'View sticker stats' },

  { code: 'sticker_category.read', module: 'settings', action: 'view', description: 'View sticker categories' },
  { code: 'sticker_category.create', module: 'settings', action: 'create', description: 'Create sticker categories' },
  { code: 'sticker_category.update', module: 'settings', action: 'edit', description: 'Update sticker categories' },
  { code: 'sticker_category.delete', module: 'settings', action: 'delete', description: 'Delete sticker categories' },
  { code: 'sticker_category.stats.view', module: 'settings', action: 'view', description: 'View sticker category stats' },

  // Growth / economy
  { code: 'daily_reward.config.read', module: 'settings', action: 'view', description: 'View daily reward config' },
  { code: 'daily_reward.config.update', module: 'settings', action: 'edit', description: 'Update daily reward config' },
  { code: 'daily_reward.stats.view', module: 'settings', action: 'view', description: 'View daily reward stats' },
  { code: 'daily_reward.claims.read', module: 'settings', action: 'view', description: 'View daily reward claims' },
  { code: 'daily_reward.cache.clear', module: 'settings', action: 'edit', description: 'Clear daily reward cache' },

  { code: 'xp.stats.view', module: 'settings', action: 'view', description: 'View XP stats' },
  { code: 'xp.transaction.read', module: 'settings', action: 'view', description: 'View XP transactions' },
  { code: 'xp.reward_claim.read', module: 'settings', action: 'view', description: 'View XP reward claims' },
  { code: 'xp.level_config.manage', module: 'settings', action: 'edit', description: 'Manage XP level configs' },
  { code: 'xp.reward.manage', module: 'settings', action: 'edit', description: 'Manage XP rewards' },
  { code: 'xp.action.update', module: 'settings', action: 'edit', description: 'Update XP actions' },
  { code: 'xp.grant', module: 'settings', action: 'approve', description: 'Grant XP' },

  { code: 'anchor_level.read', module: 'settings', action: 'view', description: 'View anchor levels' },
  { code: 'anchor_level.create', module: 'settings', action: 'create', description: 'Create anchor levels' },
  { code: 'anchor_level.update', module: 'settings', action: 'edit', description: 'Update anchor levels' },
  { code: 'anchor_level.delete', module: 'settings', action: 'delete', description: 'Delete anchor levels' },
  { code: 'anchor_level.stats.view', module: 'settings', action: 'view', description: 'View anchor level stats' },
  { code: 'anchor_level.claims.read', module: 'settings', action: 'view', description: 'View anchor claims' },

  { code: 'referral.stats.view', module: 'settings', action: 'view', description: 'View referral stats' },
  { code: 'referral.read', module: 'settings', action: 'view', description: 'View referrals' },
  { code: 'referral.config.read', module: 'settings', action: 'view', description: 'View referral config' },
  { code: 'referral.config.update', module: 'settings', action: 'edit', description: 'Update referral config' },

  { code: 'match.config.read', module: 'settings', action: 'view', description: 'View match config' },
  { code: 'match.config.update', module: 'settings', action: 'edit', description: 'Update match config' },
  { code: 'follow.analytics.view', module: 'users', action: 'view', description: 'View follow analytics' },

  // RBAC
  { code: 'role.read', module: 'settings', action: 'view', description: 'View roles' },
  { code: 'role.create', module: 'settings', action: 'create', description: 'Create roles' },
  { code: 'role.update', module: 'settings', action: 'edit', description: 'Update roles' },
  { code: 'role.delete', module: 'settings', action: 'delete', description: 'Delete roles' },
  { code: 'permission.read', module: 'settings', action: 'view', description: 'View permission catalog' },
  { code: 'audit_log.read', module: 'settings', action: 'view', description: 'View audit logs' },
];

export const PERMISSION_CODES = PERMISSION_CATALOG.map((p) => p.code);

/** @deprecated Use PERMISSION_CODES — kept for any legacy imports */
export const PERMISSIONS = PERMISSION_CODES;

/** Admin role gets all codes except destructive role delete */
export const ADMIN_ROLE_PERMISSIONS = PERMISSION_CODES.filter((c) => c !== 'role.delete');

export const MATRIX_MODULES = ['Users', 'Listeners', 'Finance', 'Moderation', 'Notifications', 'Settings'];
export const MATRIX_ACTIONS = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Export'];
