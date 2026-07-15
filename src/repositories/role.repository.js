import Role from '../modules/role.model.js';

class RoleRepository {
  async create(data) {
    return Role.create(data);
  }

  async findById(id, lean = true) {
    const q = Role.findById(id);
    return lean ? q.lean() : q;
  }

  async findBySlug(slug, lean = true) {
    const q = Role.findOne({ slug });
    return lean ? q.lean() : q;
  }

  async findOne(filter, lean = true) {
    const q = Role.findOne(filter);
    return lean ? q.lean() : q;
  }

  async findAll({ isActive, search } = {}) {
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }
    return Role.find(filter).sort({ isSystemRole: -1, name: 1 }).lean();
  }

  async updateById(id, data) {
    return Role.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
  }

  async deleteById(id) {
    return Role.findByIdAndDelete(id);
  }

  async upsertBySlug(slug, data) {
    return Role.findOneAndUpdate(
      { slug },
      { $set: { ...data, slug } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  }
}

export default new RoleRepository();
