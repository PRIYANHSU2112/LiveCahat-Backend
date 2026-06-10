import Role from '../modules/role.model.js';
import User from '../modules/user.model.js';
import { PERMISSIONS } from '../constants/enum.constant.js';
import logger from '../utils/logger.util.js';

export const seedSuperAdmin = async () => {
  try {
    // 1. Check if SUPER_ADMIN role exists
    let superAdminRole = await Role.findOne({ slug: 'super_admin' });
    
    if (!superAdminRole) {
      superAdminRole = await Role.create({
        name: 'Super Admin',
        slug: 'super_admin',
        description: 'System role with all access',
        permissions: PERMISSIONS, // all fixed permissions
        isSystemRole: true,
        isActive: true
      });
      logger.info('SUPER_ADMIN role created successfully.');
    } else {
      // Ensure super admin always has all permissions
      superAdminRole.permissions = PERMISSIONS;
      await superAdminRole.save();
    }

    // 2. Check if the default super admin user exists
    const email = 'superadmin@livechat.com';
    let superAdminUser = await User.findOne({ email });

    if (!superAdminUser) {
      superAdminUser = await User.create({
        type: 'ADMIN',
        firstName: 'Super',
        lastName: 'Admin',
        email: email,
        password: 'SuperPassword123!', // Hardcoded password
        mobileNumber: '0000000000',
        roleId: superAdminRole._id,
        profileCompleted: true
      });
      logger.info(`Super Admin user created successfully. Email: ${email}`);
    } else {
      // Ensure role is correct
      if (superAdminUser.roleId?.toString() !== superAdminRole._id.toString()) {
        superAdminUser.roleId = superAdminRole._id;
        await superAdminUser.save();
      }
    }
  } catch (error) {
    logger.error(error, 'Failed to seed Super Admin:');
  }
};
