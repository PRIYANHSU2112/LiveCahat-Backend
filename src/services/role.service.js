import roleRepository from '../repositories/role.repository.js';
import User from '../modules/user.model.js';
import ApiError from '../utils/ApiError.js';
import rbacService from './rbac.service.js';
import auditLogService from './audit-log.service.js';
import {
  PERMISSION_CODES,
  MATRIX_MODULES,
  MATRIX_ACTIONS,
} from '../constants/permission.constant.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

const ROLES_CACHE_TTL = 45;

const slugify = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Maps UI matrix module+action → permission codes that count as granted */
const MATRIX_CODE_GROUPS = {
  Users: {
    View: ['user.read', 'user.stats.view', 'user.activity.view', 'search.admin', 'agent.stats.view', 'follow.analytics.view'],
    Create: ['admin.create', 'agent.create'],
    Edit: ['agent.commission.update'],
    Delete: [],
    Approve: ['user.block'],
    Export: ['user.read'],
  },
  Listeners: {
    View: ['listener.read', 'listener.stats.view', 'listener.performance.view', 'listener.availability.view'],
    Create: ['listener.create'],
    Edit: ['listener.update'],
    Delete: [],
    Approve: ['listener.kyc.moderate'],
    Export: ['listener.read'],
  },
  Finance: {
    View: [
      'wallet.read',
      'wallet.stats.view',
      'wallet.transaction.read',
      'withdrawal.read',
      'withdrawal.stats.view',
      'settlement.read',
      'analytics.revenue.view',
      'coin_pack.read',
      'gift.read',
      'gift.stats.view',
      'gift.analytics.view',
    ],
    Create: ['coin_pack.create', 'gift.create'],
    Edit: ['wallet.adjust', 'wallet.status.update', 'withdrawal.config.update', 'coin_pack.update', 'gift.update'],
    Delete: ['coin_pack.delete', 'gift.delete'],
    Approve: ['withdrawal.approve', 'withdrawal.reject', 'settlement.run'],
    Export: ['wallet.transaction.read'],
  },
  Moderation: {
    View: ['report.read', 'report.stats.view', 'feedback.read', 'feedback.stats.view', 'report_reason.read'],
    Create: ['report_reason.create'],
    Edit: ['report_reason.update'],
    Delete: ['report_reason.delete'],
    Approve: ['report.moderate', 'feedback.moderate'],
    Export: ['report.read'],
  },
  Notifications: {
    View: ['notification.admin.read', 'notification.admin.stats.view', 'banner.read', 'banner.stats.view'],
    Create: ['notification.send', 'notification.broadcast', 'banner.create'],
    Edit: ['banner.update'],
    Delete: ['banner.delete'],
    Approve: [],
    Export: ['notification.admin.read'],
  },
  Settings: {
    View: [
      'role.read',
      'permission.read',
      'audit_log.read',
      'company.read',
      'country.read',
      'language.read',
      'communication.config.read',
      'referral.config.read',
      'match.config.read',
    ],
    Create: ['role.create', 'country.create', 'language.create', 'company.create'],
    Edit: [
      'role.update',
      'country.update',
      'language.update',
      'company.update',
      'communication.config.update',
      'referral.config.update',
      'match.config.update',
    ],
    Delete: ['role.delete', 'country.delete', 'language.delete', 'company.delete'],
    Approve: [],
    Export: ['audit_log.read'],
  },
};

class RoleService {
  async _invalidateRolesCache() {
    await bumpCacheVersion('roles');
  }

  async listRoles(query = {}) {
    const isActiveFilter =
      query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined;
    const search = query.search || '';
    const version = await getCacheVersion('roles');
    const cacheKey = `roles:list:v${version}:active=${isActiveFilter ?? 'any'}:q=${search}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const roles = await roleRepository.findAll({
      isActive: isActiveFilter,
      search: query.search,
    });

    const counts = await User.aggregate([
      { $match: { type: 'ADMIN', isDeleted: false, roleId: { $ne: null } } },
      { $group: { _id: '$roleId', memberCount: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.memberCount]));

    const result = roles.map((r) => ({
      id: r._id.toString(),
      name: r.name,
      slug: r.slug,
      description: r.description,
      isSystemRole: r.isSystemRole,
      isActive: r.isActive,
      permissions: r.permissions || [],
      memberCount: countMap.get(r._id.toString()) || 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    await setCache(cacheKey, result, ROLES_CACHE_TTL);
    return result;
  }

  async getStats() {
    const version = await getCacheVersion('roles');
    const cacheKey = `roles:stats:v${version}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const Role = (await import('../modules/role.model.js')).default;
    const auditLogRepository = (await import('../repositories/audit-log.repository.js')).default;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalRoles, adminUsers, policyChanges, latest] = await Promise.all([
      Role.countDocuments(),
      User.countDocuments({ type: 'ADMIN', isDeleted: false }),
      auditLogRepository.countRecent(since),
      auditLogRepository.findLatest(),
    ]);

    const stats = {
      totalRoles,
      adminUsers,
      policyChanges,
      lastAuditAt: latest?.createdAt || null,
    };
    await setCache(cacheKey, stats, ROLES_CACHE_TTL);
    return stats;
  }

  async getById(id) {
    const role = await roleRepository.findById(id);
    if (!role) throw new ApiError(404, 'Role not found');
    const memberCount = await User.countDocuments({ type: 'ADMIN', roleId: role._id, isDeleted: false });
    return {
      id: role._id.toString(),
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystemRole: role.isSystemRole,
      isActive: role.isActive,
      permissions: role.permissions || [],
      memberCount,
    };
  }

  async create(data, actor, reqMeta = {}) {
    const name = data.name?.trim();
    if (!name) throw new ApiError(400, 'Role name is required');
    let slug = data.slug ? slugify(data.slug) : slugify(name);
    if (!slug) throw new ApiError(400, 'Invalid role slug');

    const existing = await roleRepository.findBySlug(slug);
    if (existing) throw new ApiError(409, 'A role with this slug already exists');

    const permissions = this._sanitizePermissions(data.permissions);
    const role = await roleRepository.create({
      name,
      slug,
      description: data.description || '',
      permissions,
      isSystemRole: false,
      isActive: data.isActive !== false,
    });

    await auditLogService.record({
      actor,
      action: `Created role ${name}`,
      resource: 'role',
      resourceId: role._id,
      permission: 'role.create',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    await this._invalidateRolesCache();
    return this.getById(role._id);
  }

  async update(id, data, actor, reqMeta = {}) {
    const role = await roleRepository.findById(id, false);
    if (!role) throw new ApiError(404, 'Role not found');

    if (role.slug === 'super_admin') {
      if (data.slug && slugify(data.slug) !== 'super_admin') {
        throw new ApiError(403, 'Cannot rename the Super Admin role');
      }
      // Always keep full catalog for super_admin
      data.permissions = PERMISSION_CODES;
      data.isSystemRole = true;
      data.isActive = true;
    }

    if (data.name !== undefined) role.name = data.name.trim();
    if (data.description !== undefined) role.description = data.description;
    if (data.isActive !== undefined && role.slug !== 'super_admin') role.isActive = data.isActive;
    if (data.permissions !== undefined) {
      role.permissions =
        role.slug === 'super_admin' ? PERMISSION_CODES : this._sanitizePermissions(data.permissions);
    }

    await role.save();

    // Invalidate permission caches for members of this role
    const members = await User.find({ type: 'ADMIN', roleId: role._id }).select('_id').lean();
    await Promise.all(members.map((m) => rbacService.invalidateUser(m._id)));

    await auditLogService.record({
      actor,
      action: `Updated role ${role.name}`,
      resource: 'role',
      resourceId: role._id,
      permission: 'role.update',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    await this._invalidateRolesCache();
    return this.getById(role._id);
  }

  async remove(id, actor, reqMeta = {}) {
    const role = await roleRepository.findById(id);
    if (!role) throw new ApiError(404, 'Role not found');
    if (role.isSystemRole || role.slug === 'super_admin') {
      throw new ApiError(403, 'System roles cannot be deleted');
    }

    const memberCount = await User.countDocuments({ roleId: role._id, isDeleted: false });
    if (memberCount > 0) {
      throw new ApiError(400, 'Reassign admins before deleting this role');
    }

    await roleRepository.deleteById(id);
    await auditLogService.record({
      actor,
      action: `Deleted role ${role.name}`,
      resource: 'role',
      resourceId: id,
      permission: 'role.delete',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    await this._invalidateRolesCache();
    return { deleted: true };
  }

  async getMatrix(id) {
    const role = await roleRepository.findById(id);
    if (!role) throw new ApiError(404, 'Role not found');
    const set = new Set(role.permissions || []);

    const matrix = MATRIX_MODULES.map((module) => {
      const row = { module };
      for (const action of MATRIX_ACTIONS) {
        const codes = MATRIX_CODE_GROUPS[module]?.[action] || [];
        row[action] = codes.length > 0 && codes.every((c) => set.has(c));
      }
      return row;
    });

    return {
      roleId: role._id.toString(),
      roleName: role.name,
      modules: MATRIX_MODULES,
      actions: MATRIX_ACTIONS,
      matrix,
    };
  }

  async putMatrix(id, cells, actor, reqMeta = {}) {
    const role = await roleRepository.findById(id, false);
    if (!role) throw new ApiError(404, 'Role not found');
    if (role.slug === 'super_admin') {
      role.permissions = PERMISSION_CODES;
      await role.save();
      return this.getMatrix(id);
    }

    const granted = new Set();
    for (const cell of cells || []) {
      if (!cell.granted) continue;
      const codes = MATRIX_CODE_GROUPS[cell.module]?.[cell.action] || [];
      codes.forEach((c) => granted.add(c));
    }

    // Preserve non-matrix permissions that still exist on the role
    const matrixAll = new Set();
    for (const mod of Object.values(MATRIX_CODE_GROUPS)) {
      for (const codes of Object.values(mod)) codes.forEach((c) => matrixAll.add(c));
    }
    for (const code of role.permissions || []) {
      if (!matrixAll.has(code) && PERMISSION_CODES.includes(code)) granted.add(code);
    }

    role.permissions = [...granted];
    await role.save();

    const members = await User.find({ type: 'ADMIN', roleId: role._id }).select('_id').lean();
    await Promise.all(members.map((m) => rbacService.invalidateUser(m._id)));

    await auditLogService.record({
      actor,
      action: `Updated permission matrix for ${role.name}`,
      resource: 'role',
      resourceId: role._id,
      permission: 'role.update',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    await this._invalidateRolesCache();
    return this.getMatrix(id);
  }

  async getMembers(id, query = {}) {
    const role = await roleRepository.findById(id);
    if (!role) throw new ApiError(404, 'Role not found');
    const { page, limit, skip, sort } = getPaginationOptions(query);
    const filter = { type: 'ADMIN', roleId: role._id, isDeleted: false };
    const [docs, total] = await Promise.all([
      User.find(filter).select('firstName lastName email roleId createdAt').sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    return formatPaginatedResponse(
      docs.map((u) => ({
        id: u._id.toString(),
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit
    );
  }

  async listPolicies() {
    const version = await getCacheVersion('roles');
    const cacheKey = `roles:policies:v${version}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const roles = await this.listRoles({ isActive: 'true' });
    const policies = roles.map((r) => ({
      id: r.id,
      policy: r.name,
      scope: this._primaryScope(r.permissions),
      roles: `${r.memberCount} member${r.memberCount === 1 ? '' : 's'}`,
      status: r.isActive ? 'active' : 'inactive',
    }));
    await setCache(cacheKey, policies, ROLES_CACHE_TTL);
    return policies;
  }

  async assignRoleToAdmin(adminUserId, roleId, actor, reqMeta = {}) {
    const user = await User.findOne({ _id: adminUserId, type: 'ADMIN', isDeleted: false });
    if (!user) throw new ApiError(404, 'Admin user not found');

    const role = await roleRepository.findById(roleId);
    if (!role || !role.isActive) throw new ApiError(404, 'Role not found or inactive');

    if (user.roleId?.toString() === role._id.toString()) {
      return { id: user._id.toString(), roleId: role._id.toString(), roleSlug: role.slug };
    }

    // Prevent removing last super_admin
    if (user.roleId) {
      const prev = await roleRepository.findById(user.roleId);
      if (prev?.slug === 'super_admin') {
        const remaining = await User.countDocuments({
          type: 'ADMIN',
          roleId: prev._id,
          isDeleted: false,
          _id: { $ne: user._id },
        });
        if (remaining === 0 && role.slug !== 'super_admin') {
          throw new ApiError(403, 'Cannot remove the last Super Admin');
        }
      }
    }

    user.roleId = role._id;
    await user.save();
    await rbacService.invalidateUser(user._id);

    await auditLogService.record({
      actor,
      action: `Changed role of ${user.firstName || ''} ${user.lastName || ''} to ${role.name}`.trim(),
      resource: 'user',
      resourceId: user._id,
      permission: 'role.update',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      meta: { roleId: role._id.toString(), roleSlug: role.slug },
    });

    await this._invalidateRolesCache();
    return { id: user._id.toString(), roleId: role._id.toString(), roleSlug: role.slug };
  }

  _sanitizePermissions(list = []) {
    const allowed = new Set(PERMISSION_CODES);
    return [...new Set((list || []).filter((c) => allowed.has(c)))];
  }

  _primaryScope(permissions = []) {
    const scores = { Users: 0, Listeners: 0, Finance: 0, Moderation: 0, Notifications: 0, Settings: 0 };
    for (const [module, actions] of Object.entries(MATRIX_CODE_GROUPS)) {
      for (const codes of Object.values(actions)) {
        for (const c of codes) {
          if (permissions.includes(c)) scores[module] += 1;
        }
      }
    }
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Platform';
  }
}

export default new RoleService();
