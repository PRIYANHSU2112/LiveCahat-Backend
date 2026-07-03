import BaseService from './base.service.js';
import reportReasonRepository from '../repositories/report-reason.repository.js';
import userReportRepository from '../repositories/user-report.repository.js';
import ApiError from '../utils/ApiError.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';

class ReportReasonService extends BaseService {
  constructor() {
    super(reportReasonRepository);
  }

  async getActiveReasons() {
    const reasons = await this.repository.findMany(
      { isActive: true },
      'label description sortOrder',
      '',
      { sortOrder: 1, label: 1 },
      100,
      0
    );
    return {
      reasons: reasons.map((r) => ({
        id: r._id,
        label: r.label,
        description: r.description ?? undefined,
      })),
    };
  }

  async getAllReasons(query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'sortOrder',
      sortOrder: 'asc',
      ...query,
    });

    const filter = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive === true || query.isActive === 'true';
    if (query.search?.trim()) {
      filter.$or = [
        { label: { $regex: query.search.trim(), $options: 'i' } },
        { description: { $regex: query.search.trim(), $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      this.repository.findMany(
        filter,
        '',
        { path: 'createdBy', select: 'firstName lastName email' },
        sort,
        limit,
        skip
      ),
      this.repository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs, total, page, limit);
  }

  async validateActiveReasons(reasonIds) {
    const uniqueIds = [...new Set(reasonIds.map(String))];
    const reasons = await this.repository.findMany(
      { _id: { $in: uniqueIds }, isActive: true },
      'label sortOrder',
      '',
      { sortOrder: 1, label: 1 }
    );
    if (reasons.length !== uniqueIds.length) {
      throw new ApiError(400, 'One or more selected reasons are invalid or inactive');
    }
    return reasons;
  }

  async createReason(adminId, { label, description, sortOrder }) {
    const trimmed = label.trim();
    const existing = await this.repository.findOne({ label: trimmed });
    if (existing) throw new ApiError(400, 'A reason with this label already exists');

    return this.repository.create({
      label: trimmed,
      description: description?.trim() || null,
      sortOrder: sortOrder ?? 0,
      createdBy: adminId,
    });
  }

  async updateReason(id, { label, description, sortOrder }) {
    const reason = await this.repository.findById(id, '', '', false);
    if (!reason) throw new ApiError(404, 'Report reason not found');

    if (label !== undefined) {
      const trimmed = label.trim();
      const duplicate = await this.repository.findOne({ label: trimmed, _id: { $ne: id } });
      if (duplicate) throw new ApiError(400, 'A reason with this label already exists');
      reason.label = trimmed;
    }
    if (description !== undefined) reason.description = description?.trim() || null;
    if (sortOrder !== undefined) reason.sortOrder = sortOrder;

    await reason.save();
    return reason;
  }

  async toggleReason(id, isActive) {
    const reason = await this.repository.findById(id, '', '', false);
    if (!reason) throw new ApiError(404, 'Report reason not found');

    reason.isActive = isActive !== undefined ? isActive : !reason.isActive;
    await reason.save();
    return reason;
  }

  async deleteReason(id) {
    const reason = await this.repository.findById(id, '', '', false);
    if (!reason) throw new ApiError(404, 'Report reason not found');

    const inUse = await userReportRepository.findOne({ reasonIds: id });
    if (inUse) {
      reason.isActive = false;
      await reason.save();
      return { deleted: false, deactivated: true, reason };
    }

    await this.repository.deleteById(id);
    return { deleted: true, deactivated: false };
  }
}

export default new ReportReasonService();
