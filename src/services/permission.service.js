import permissionRepository from '../repositories/permission.repository.js';
import {
  MATRIX_MODULES,
  MATRIX_ACTIONS,
  PERMISSION_CATALOG,
} from '../constants/permission.constant.js';
import { getCache, setCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

const CATALOG_TTL = 600; // 10 minutes

class PermissionService {
  async list(query = {}) {
    const isActive = query.isActive === 'false' ? false : true;
    const version = await getCacheVersion('rbac:permissions');
    const cacheKey = `rbac:permissions:catalog:active=${isActive}:v${version}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const docs = await permissionRepository.findAll({ isActive });
    let result;
    if (docs.length) {
      result = docs.map((d) => ({
        id: d._id.toString(),
        code: d.code,
        module: d.module,
        action: d.action,
        description: d.description,
        isActive: d.isActive,
      }));
    } else {
      // Fallback to catalog if DB empty (pre-seed)
      result = PERMISSION_CATALOG.map((p, i) => ({
        id: String(i),
        code: p.code,
        module: p.module,
        action: p.action,
        description: p.description,
        isActive: true,
      }));
    }

    await setCache(cacheKey, result, CATALOG_TTL);
    return result;
  }

  getMatrixMeta() {
    return { modules: MATRIX_MODULES, actions: MATRIX_ACTIONS };
  }

  async invalidateCatalog() {
    await bumpCacheVersion('rbac:permissions');
  }
}

export default new PermissionService();
