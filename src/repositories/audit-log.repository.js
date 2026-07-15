import AuditLog from '../modules/audit-log.model.js';

class AuditLogRepository {
  async create(data) {
    return AuditLog.create(data);
  }

  async findPaginated({ filter, skip, limit, sort }) {
    const [docs, totalDocuments] = await Promise.all([
      AuditLog.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    return { docs, totalDocuments };
  }

  async countRecent(since) {
    return AuditLog.countDocuments({ createdAt: { $gte: since } });
  }

  async findLatest() {
    return AuditLog.findOne().sort({ createdAt: -1 }).lean();
  }
}

export default new AuditLogRepository();
