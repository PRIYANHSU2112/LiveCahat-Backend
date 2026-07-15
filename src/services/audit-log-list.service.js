import auditLogRepository from '../repositories/audit-log.repository.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

class AuditLogListService {
  async list(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions(query);
    const filter = {};

    if (query.search) {
      const s = query.search.trim();
      filter.$or = [
        { actorName: { $regex: s, $options: 'i' } },
        { action: { $regex: s, $options: 'i' } },
        { ip: { $regex: s, $options: 'i' } },
        { resource: { $regex: s, $options: 'i' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      filter.createdAt = {};
      if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
    }

    const { docs, totalDocuments } = await auditLogRepository.findPaginated({
      filter,
      skip,
      limit,
      sort,
    });

    return formatPaginatedResponse(
      docs.map((d) => ({
        id: d._id.toString(),
        user: d.actorName || 'System',
        action: d.action,
        time: d.createdAt,
        ip: d.ip || '—',
        resource: d.resource,
        resourceId: d.resourceId,
        permission: d.permission,
      })),
      totalDocuments,
      page,
      limit
    );
  }
}

export default new AuditLogListService();
