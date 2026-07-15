import Permission from '../modules/permission.model.js';

class PermissionRepository {
  async upsertByCode(data) {
    return Permission.findOneAndUpdate(
      { code: data.code },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  }

  async bulkUpsert(items) {
    if (!items?.length) return;
    const ops = items.map((item) => ({
      updateOne: {
        filter: { code: item.code },
        update: { $set: item },
        upsert: true,
      },
    }));
    return Permission.bulkWrite(ops, { ordered: false });
  }

  async findAll({ isActive } = {}) {
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive;
    return Permission.find(filter).sort({ module: 1, action: 1, code: 1 }).lean();
  }

  async findByCode(code) {
    return Permission.findOne({ code }).lean();
  }
}

export default new PermissionRepository();
