import permissionRepository from '../repositories/permission.repository.js';
import {
  MATRIX_MODULES,
  MATRIX_ACTIONS,
  PERMISSION_CATALOG,
} from '../constants/permission.constant.js';

class PermissionService {
  async list(query = {}) {
    const docs = await permissionRepository.findAll({
      isActive: query.isActive === 'false' ? false : true,
    });
    if (docs.length) {
      return docs.map((d) => ({
        id: d._id.toString(),
        code: d.code,
        module: d.module,
        action: d.action,
        description: d.description,
        isActive: d.isActive,
      }));
    }
    // Fallback to catalog if DB empty (pre-seed)
    return PERMISSION_CATALOG.map((p, i) => ({
      id: String(i),
      code: p.code,
      module: p.module,
      action: p.action,
      description: p.description,
      isActive: true,
    }));
  }

  getMatrixMeta() {
    return { modules: MATRIX_MODULES, actions: MATRIX_ACTIONS };
  }
}

export default new PermissionService();
