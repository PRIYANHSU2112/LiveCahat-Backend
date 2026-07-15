import roleRepository from '../repositories/role.repository.js';
import { PERMISSION_CODES } from '../constants/permission.constant.js';
import { getCache, setCache, deleteCache } from '../utils/redis.util.js';
import ApiError from '../utils/ApiError.js';

const PERMS_TTL = 120;
const permsKey = (userId) => `auth:perms:${userId}`;

class RbacService {
  async getUserPermissions(user) {
    if (!user) return { roleSlug: null, permissions: [] };

    // Non-admin product actors do not use granular permissions
    if (user.type !== 'ADMIN') {
      return { roleSlug: null, permissions: [] };
    }

    const userId = user._id?.toString?.() || user.id?.toString?.() || String(user._id);
    const cacheKey = permsKey(userId);
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    if (!user.roleId) {
      throw new ApiError(403, 'Admin account has no role assigned. Contact a Super Admin.');
    }

    const role = await roleRepository.findById(user.roleId);
    if (!role || !role.isActive) {
      throw new ApiError(403, 'Your admin role is inactive or missing.');
    }

    let permissions = Array.isArray(role.permissions) ? [...role.permissions] : [];
    if (role.slug === 'super_admin') {
      permissions = [...PERMISSION_CODES];
    }

    const payload = { roleSlug: role.slug, permissions, roleId: role._id.toString() };
    await setCache(cacheKey, payload, PERMS_TTL);
    return payload;
  }

  hasPermission(permissionSet, required) {
    if (!required) return true;
    const set = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
    return set.has(required);
  }

  hasAllPermissions(permissionSet, requiredList = []) {
    const set = permissionSet instanceof Set ? permissionSet : new Set(permissionSet || []);
    return requiredList.every((p) => set.has(p));
  }

  async invalidateUser(userId) {
    if (!userId) return;
    await deleteCache(permsKey(userId.toString()));
    await deleteCache(`auth:user:${userId}`);
  }

  async invalidateUsersWithRole(roleId) {
    // Best-effort: callers should also bump auth:user for known admins.
    // Full scan is expensive; role updates invalidate per-member when assigning.
    if (!roleId) return;
  }
}

export default new RbacService();
