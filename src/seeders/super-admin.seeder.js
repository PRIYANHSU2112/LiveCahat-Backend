import Role from '../modules/role.model.js';
import User from '../modules/user.model.js';
import permissionRepository from '../repositories/permission.repository.js';
import roleRepository from '../repositories/role.repository.js';
import {
  PERMISSION_CATALOG,
  PERMISSION_CODES,
  ADMIN_ROLE_PERMISSIONS,
} from '../constants/permission.constant.js';
import logger from '../utils/logger.util.js';

const DEFAULT_ROLES = [
  {
    name: 'Super Admin',
    slug: 'super_admin',
    description: 'Full unrestricted access',
    permissions: PERMISSION_CODES,
    isSystemRole: true,
  },
  {
    name: 'Admin',
    slug: 'admin',
    description: 'Manage most platform areas',
    permissions: ADMIN_ROLE_PERMISSIONS,
    isSystemRole: true,
  },
  {
    name: 'Finance Manager',
    slug: 'finance_manager',
    description: 'Wallets, payouts & revenue',
    permissions: [
      'dashboard.view',
      'analytics.revenue.view',
      'wallet.read',
      'wallet.stats.view',
      'wallet.transaction.read',
      'wallet.adjust',
      'wallet.status.update',
      'withdrawal.read',
      'withdrawal.stats.view',
      'withdrawal.config.update',
      'withdrawal.approve',
      'withdrawal.reject',
      'settlement.read',
      'settlement.run',
      'coin_pack.read',
      'coin_pack.create',
      'coin_pack.update',
      'coin_pack.delete',
      'coin_pack.stats.view',
      'gift.read',
      'gift.stats.view',
      'gift.analytics.view',
    ],
    isSystemRole: false,
  },
  {
    name: 'Moderator',
    slug: 'moderator',
    description: 'Reports & content safety',
    permissions: [
      'dashboard.view',
      'user.read',
      'user.block',
      'listener.read',
      'listener.kyc.moderate',
      'report.read',
      'report.stats.view',
      'report.moderate',
      'report_reason.read',
      'report_reason.create',
      'report_reason.update',
      'feedback.read',
      'feedback.stats.view',
      'feedback.moderate',
      'communication.session.read',
      'communication.session.force_end',
    ],
    isSystemRole: false,
  },
  {
    name: 'Support Agent',
    slug: 'support_agent',
    description: 'Tickets & live support',
    permissions: [
      'dashboard.view',
      'user.read',
      'listener.read',
      'feedback.read',
      'feedback.moderate',
      'notification.admin.read',
      'search.admin',
    ],
    isSystemRole: false,
  },
  {
    name: 'Marketing Manager',
    slug: 'marketing_manager',
    description: 'Campaigns & notifications',
    permissions: [
      'dashboard.view',
      'banner.read',
      'banner.create',
      'banner.update',
      'banner.delete',
      'banner.stats.view',
      'notification.send',
      'notification.broadcast',
      'notification.admin.read',
      'notification.admin.stats.view',
      'gift.read',
      'coin_pack.read',
      'referral.read',
      'referral.stats.view',
      'referral.config.read',
      'referral.config.update',
    ],
    isSystemRole: false,
  },
];

export const seedSuperAdmin = async () => {
  try {
    // 1. Upsert permission catalog
    await permissionRepository.bulkUpsert(
      PERMISSION_CATALOG.map((p) => ({
        code: p.code,
        module: p.module,
        action: p.action,
        description: p.description,
        isActive: true,
      }))
    );

    // 2. Upsert default roles
    const rolesBySlug = {};
    for (const roleDef of DEFAULT_ROLES) {
      const role = await roleRepository.upsertBySlug(roleDef.slug, {
        name: roleDef.name,
        description: roleDef.description,
        permissions: roleDef.permissions,
        isSystemRole: roleDef.isSystemRole,
        isActive: true,
      });
      rolesBySlug[roleDef.slug] = role;
    }

    // Ensure super_admin always has the full current catalog
    await Role.findOneAndUpdate(
      { slug: 'super_admin' },
      { $set: { permissions: PERMISSION_CODES, isSystemRole: true, isActive: true } }
    );

    const superAdminRole = rolesBySlug.super_admin || (await roleRepository.findBySlug('super_admin'));
    const adminRole = rolesBySlug.admin || (await roleRepository.findBySlug('admin'));

    // 3. Ensure Super Admin user
    const email = 'superadmin@livechat.com';
    let superAdminUser = await User.findOne({ email });

    if (!superAdminUser) {
      superAdminUser = await User.create({
        type: 'ADMIN',
        firstName: 'Super',
        lastName: 'Admin',
        email,
        password: 'SuperPassword123!',
        mobileNumber: '0000000000',
        roleId: superAdminRole._id,
        profileCompleted: true,
      });
      logger.info(`Super Admin user created successfully. Email: ${email}`);
    } else if (superAdminUser.roleId?.toString() !== superAdminRole._id.toString()) {
      superAdminUser.roleId = superAdminRole._id;
      await superAdminUser.save();
    }

    // 4. Backfill ADMIN users missing roleId → admin role
    if (adminRole?._id) {
      const result = await User.updateMany(
        { type: 'ADMIN', isDeleted: false, $or: [{ roleId: null }, { roleId: { $exists: false } }] },
        { $set: { roleId: adminRole._id } }
      );
      if (result.modifiedCount > 0) {
        logger.info(`Backfilled roleId=admin for ${result.modifiedCount} ADMIN user(s).`);
      }
    }

    logger.info('RBAC seed completed (permissions + roles + super admin).');
  } catch (error) {
    logger.error(error, 'Failed to seed Super Admin / RBAC:');
  }
};
