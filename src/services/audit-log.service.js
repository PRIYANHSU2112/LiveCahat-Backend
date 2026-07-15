import auditLogRepository from '../repositories/audit-log.repository.js';
import logger from '../utils/logger.util.js';

class AuditLogService {
  /**
   * Fire-and-forget audit write — never throws to callers.
   */
  async record({
    actor,
    action,
    resource = '',
    resourceId = null,
    permission = null,
    ip = null,
    userAgent = null,
    meta = null,
  }) {
    try {
      const actorName = actor
        ? `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || actor.email || 'Admin'
        : 'System';

      await auditLogRepository.create({
        actorId: actor?._id || actor?.id || null,
        actorType: actor?.type || 'SYSTEM',
        actorName,
        action,
        resource,
        resourceId: resourceId != null ? String(resourceId) : null,
        permission,
        ip,
        userAgent,
        meta,
      });
    } catch (err) {
      logger.error(err, 'Failed to write audit log');
    }
  }
}

export default new AuditLogService();
