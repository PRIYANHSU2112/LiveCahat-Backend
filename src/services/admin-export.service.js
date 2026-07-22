import User from '../modules/user.model.js';
import Country from '../modules/country.model.js';
import Language from '../modules/language.model.js';
import Gift from '../modules/gift.model.js';
import CoinPack from '../modules/coin-pack.model.js';
import Banner from '../modules/banner.model.js';
import Avatar from '../modules/avatar.model.js';
import Sticker from '../modules/sticker.model.js';
import AuditLog from '../modules/audit-log.model.js';
import Role from '../modules/role.model.js';
import userService from './user.service.js';
import listenerService from './listener.service.js';
import { walletService } from './wallet.service.js';
import withdrawalService from './withdrawal.service.js';
import adminCommunicationService from './admin-communication.service.js';
import referralService from './referral.service.js';
import {
  streamXlsx,
  streamXlsxFromQuery,
  exportFilename,
  formatExportDate,
  formatFullName,
  MAX_EXPORT_ROWS,
  EXPORT_BATCH_SIZE,
} from '../utils/export.util.js';
import ApiError from '../utils/ApiError.js';

const boolish = (v) => v === true || v === 'true';

/**
 * Export via reused list service (paginated batches). Accurate filters, bounded memory.
 */
async function streamFromListFn(res, { filename, sheetName, columns, mapRow, listFn }) {
  const probe = await listFn(1, 1);
  const total = probe?.meta?.totalDocuments ?? probe?.docs?.length ?? 0;
  if (total > MAX_EXPORT_ROWS) {
    throw new ApiError(
      400,
      `Export exceeds ${MAX_EXPORT_ROWS.toLocaleString()} rows (${total.toLocaleString()} matched). Narrow your filters and try again.`
    );
  }

  await streamXlsx(res, {
    filename,
    sheetName,
    columns,
    countFn: async () => total,
    rowIteratorFn: async function* () {
      let page = 1;
      const limit = EXPORT_BATCH_SIZE;
      while (true) {
        const result = await listFn(page, limit);
        const docs = result?.docs ?? [];
        if (!docs.length) break;
        for (const doc of docs) {
          yield mapRow(doc);
        }
        if (!result?.meta?.hasNextPage) break;
        page += 1;
      }
    },
  });
}

function buildUserMatch(queryParams = {}) {
  const matchQuery = { isDeleted: false };
  if (queryParams.type) matchQuery.type = queryParams.type;
  if (queryParams.isBlocked !== undefined) matchQuery.isBlocked = boolish(queryParams.isBlocked);
  if (queryParams.search) {
    const s = String(queryParams.search).trim();
    if (s) {
      matchQuery.$or = [
        { firstName: { $regex: s, $options: 'i' } },
        { lastName: { $regex: s, $options: 'i' } },
        { mobileNumber: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
      ];
    }
  }
  return matchQuery;
}

class AdminExportService {
  // ─── Wave 1 ─────────────────────────────────────────────────────────────

  async exportUsers(queryParams, res) {
    const match = buildUserMatch(queryParams);
    const query = User.find(match)
      .select(
        'type firstName lastName email mobileNumber username gender isBlocked isOnline profileCompleted createdAt'
      )
      .sort({ createdAt: -1 })
      .lean();

    await streamXlsxFromQuery(res, {
      filename: exportFilename(queryParams.type === 'AGENT' ? 'agents' : 'users'),
      sheetName: queryParams.type || 'Users',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'First Name', key: 'firstName', width: 16 },
        { header: 'Last Name', key: 'lastName', width: 16 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'Mobile', key: 'mobileNumber', width: 16 },
        { header: 'Username', key: 'username', width: 16 },
        { header: 'Gender', key: 'gender', width: 10 },
        { header: 'Blocked', key: 'isBlocked', width: 10 },
        { header: 'Online', key: 'isOnline', width: 10 },
        { header: 'Profile Completed', key: 'profileCompleted', width: 16 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        type: d.type ?? '',
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        email: d.email ?? '',
        mobileNumber: d.mobileNumber ?? '',
        username: d.username ?? '',
        gender: d.gender ?? '',
        isBlocked: d.isBlocked ? 'Yes' : 'No',
        isOnline: d.isOnline ? 'Yes' : 'No',
        profileCompleted: d.profileCompleted ? 'Yes' : 'No',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportListeners(queryParams, res) {
    await streamFromListFn(res, {
      filename: exportFilename('listeners'),
      sheetName: 'Listeners',
      columns: [
        { header: 'Profile ID', key: 'id', width: 26 },
        { header: 'User ID', key: 'userId', width: 26 },
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Mobile', key: 'mobile', width: 16 },
        { header: 'KYC', key: 'kycStatus', width: 14 },
        { header: 'Profile Status', key: 'profileStatus', width: 14 },
        { header: 'Availability', key: 'availability', width: 12 },
        { header: 'Blocked', key: 'isBlocked', width: 10 },
        { header: 'Anchor Level', key: 'anchorLevel', width: 12 },
        { header: 'Avg Rating', key: 'avgRating', width: 10 },
        { header: 'Sessions', key: 'totalSessions', width: 10 },
        { header: 'Earnings', key: 'totalEarnings', width: 12 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      listFn: (page, limit) =>
        listenerService.getAllListeners({ ...queryParams, page, limit }),
      mapRow: (d) => {
        const u = d.user || {};
        return {
          id: d._id?.toString?.() ?? d.id ?? '',
          userId: (u._id || d.userId)?.toString?.() ?? '',
          name: formatFullName(u),
          email: u.email ?? '',
          mobile: u.mobileNumber ?? '',
          kycStatus: d.kycStatus ?? '',
          profileStatus: d.profileStatus ?? '',
          availability: d.availability ?? '',
          isBlocked: u.isBlocked ? 'Yes' : 'No',
          anchorLevel: d.anchorLevel ?? '',
          avgRating: d.avgRating ?? '',
          totalSessions: d.totalSessions ?? '',
          totalEarnings: d.totalEarnings ?? '',
          createdAt: formatExportDate(d.createdAt),
        };
      },
    });
  }

  async exportCoinTransactions(queryParams, res) {
    await streamFromListFn(res, {
      filename: exportFilename('coin_transactions'),
      sheetName: 'CoinTransactions',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'User ID', key: 'userId', width: 26 },
        { header: 'User', key: 'userName', width: 22 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Amount', key: 'amount', width: 12 },
        { header: 'Balance After', key: 'balanceAfter', width: 14 },
        { header: 'Reference Type', key: 'referenceType', width: 16 },
        { header: 'Reference ID', key: 'referenceId', width: 26 },
        { header: 'Description', key: 'description', width: 28 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      listFn: (page, limit) =>
        walletService.adminGetAllCoinTransactions({ ...queryParams, page, limit }),
      mapRow: (d) => {
        const u = d.user || {};
        return {
          id: d._id?.toString?.() ?? d.id ?? '',
          userId: (d.userId?._id || d.userId)?.toString?.() ?? '',
          userName: formatFullName(u) || formatFullName(d.userId),
          email: u.email || d.userId?.email || '',
          type: d.type ?? '',
          amount: d.amount ?? '',
          balanceAfter: d.balanceAfter ?? '',
          referenceType: d.referenceType ?? '',
          referenceId: d.referenceId?.toString?.() ?? d.referenceId ?? '',
          description: d.description ?? '',
          createdAt: formatExportDate(d.createdAt),
        };
      },
    });
  }

  async exportPaymentTransactions(queryParams, res) {
    await streamFromListFn(res, {
      filename: exportFilename('payment_transactions'),
      sheetName: 'PaymentTransactions',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'User', key: 'userName', width: 22 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Amount', key: 'amount', width: 12 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Gateway', key: 'paymentGateway', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Order ID', key: 'orderId', width: 22 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      listFn: (page, limit) =>
        walletService.adminGetAllPaymentTransactions({ ...queryParams, page, limit }),
      mapRow: (d) => {
        const u = d.user || d.userId || {};
        return {
          id: d._id?.toString?.() ?? d.id ?? '',
          userName: formatFullName(u),
          email: u.email ?? '',
          amount: d.amount ?? '',
          currency: d.currency ?? '',
          paymentGateway: d.paymentGateway ?? '',
          status: d.status ?? '',
          orderId: d.OrderId || d.orderId || '',
          createdAt: formatExportDate(d.createdAt),
        };
      },
    });
  }

  async exportWithdrawals(queryParams, res) {
    await streamFromListFn(res, {
      filename: exportFilename('withdrawals'),
      sheetName: 'Withdrawals',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'User', key: 'userName', width: 22 },
        { header: 'Email', key: 'email', width: 26 },
        { header: 'Type', key: 'userType', width: 12 },
        { header: 'Coins', key: 'amountCoins', width: 12 },
        { header: 'Net INR', key: 'netInr', width: 12 },
        { header: 'Method', key: 'method', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Requested At', key: 'requestedAt', width: 24 },
        { header: 'Processed At', key: 'processedAt', width: 24 },
      ],
      listFn: (page, limit) =>
        withdrawalService.adminListWithdrawals({ ...queryParams, page, limit }),
      mapRow: (d) => {
        const u = d.user || {};
        return {
          id: d.id || d._id?.toString?.() || '',
          userName: formatFullName(u) || [u.firstName, u.lastName].filter(Boolean).join(' '),
          email: u.email ?? '',
          userType: u.type ?? d.userType ?? '',
          amountCoins: d.amountCoins ?? d.amount ?? '',
          netInr: d.netInr ?? '',
          method: d.method ?? '',
          status: d.status ?? '',
          requestedAt: formatExportDate(d.requestedAt),
          processedAt: formatExportDate(d.processedAt),
        };
      },
    });
  }

  async exportReports(queryParams, res) {
    const UserReport = (await import('../modules/user-report.model.js')).default;
    const { buildUtcCreatedAtFilter } = await import('../utils/date-filter.util.js');
    const mongoose = (await import('mongoose')).default;

    const filter = { ...buildUtcCreatedAtFilter(queryParams) };
    if (queryParams.status) filter.status = queryParams.status;
    if (queryParams.reasonId && mongoose.Types.ObjectId.isValid(queryParams.reasonId)) {
      filter.reasonIds = queryParams.reasonId;
    }
    if (queryParams.reporterType) filter.reporterType = queryParams.reporterType;
    if (queryParams.targetType) filter.targetType = queryParams.targetType;
    if (queryParams.search?.trim()) {
      const regex = { $regex: queryParams.search.trim(), $options: 'i' };
      filter.$or = [{ message: regex }, { reasonLabels: regex }];
    }

    const query = UserReport.find(filter)
      .populate('reporterId', 'firstName lastName email')
      .populate('targetId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    await streamXlsxFromQuery(res, {
      filename: exportFilename('reports'),
      sheetName: 'Reports',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Reporter Type', key: 'reporterType', width: 14 },
        { header: 'Target Type', key: 'targetType', width: 14 },
        { header: 'Reporter', key: 'reporter', width: 22 },
        { header: 'Target', key: 'target', width: 22 },
        { header: 'Reasons', key: 'reasons', width: 24 },
        { header: 'Message', key: 'message', width: 36 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        status: d.status ?? '',
        reporterType: d.reporterType ?? '',
        targetType: d.targetType ?? '',
        reporter: formatFullName(d.reporterId) || d.reporterId?.email || '',
        target: formatFullName(d.targetId) || d.targetId?.email || '',
        reasons: Array.isArray(d.reasonLabels) ? d.reasonLabels.join(', ') : '',
        message: d.message ?? '',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportAuditLogs(queryParams, res) {
    const filter = {};
    if (queryParams.search) {
      const s = String(queryParams.search).trim();
      if (s) {
        filter.$or = [
          { actorName: { $regex: s, $options: 'i' } },
          { action: { $regex: s, $options: 'i' } },
          { ip: { $regex: s, $options: 'i' } },
          { resource: { $regex: s, $options: 'i' } },
        ];
      }
    }
    if (queryParams.dateFrom || queryParams.dateTo) {
      filter.createdAt = {};
      if (queryParams.dateFrom) filter.createdAt.$gte = new Date(queryParams.dateFrom);
      if (queryParams.dateTo) filter.createdAt.$lte = new Date(queryParams.dateTo);
    }

    const query = AuditLog.find(filter)
      .select('actorName action ip resource resourceId permission createdAt')
      .sort({ createdAt: -1 })
      .lean();

    await streamXlsxFromQuery(res, {
      filename: exportFilename('audit_logs'),
      sheetName: 'AuditLogs',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'User', key: 'user', width: 22 },
        { header: 'Action', key: 'action', width: 40 },
        { header: 'Resource', key: 'resource', width: 16 },
        { header: 'Resource ID', key: 'resourceId', width: 26 },
        { header: 'Permission', key: 'permission', width: 20 },
        { header: 'IP', key: 'ip', width: 16 },
        { header: 'Time', key: 'time', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        user: d.actorName || 'System',
        action: d.action ?? '',
        resource: d.resource ?? '',
        resourceId: d.resourceId?.toString?.() ?? '',
        permission: d.permission ?? '',
        ip: d.ip ?? '',
        time: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportSessions(queryParams, res) {
    const mapRow = (d) => ({
      id: d._id?.toString?.() ?? d.id ?? '',
      status: d.status ?? '',
      mode: d.mode ?? '',
      caller: d.caller?.name || formatFullName(d.caller) || '',
      listener: d.listener?.name || formatFullName(d.listener) || '',
      duration: d.duration ?? '',
      totalCoinsSpent: d.totalCoinsSpent ?? '',
      totalCoinsEarned: d.totalCoinsEarned ?? '',
      startTime: formatExportDate(d.startTime),
      endTime: formatExportDate(d.endTime),
      createdAt: formatExportDate(d.createdAt),
    });

    await streamXlsx(res, {
      filename: exportFilename('sessions'),
      sheetName: 'Sessions',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Mode', key: 'mode', width: 10 },
        { header: 'Caller', key: 'caller', width: 22 },
        { header: 'Listener', key: 'listener', width: 22 },
        { header: 'Duration (s)', key: 'duration', width: 12 },
        { header: 'Coins Spent', key: 'totalCoinsSpent', width: 12 },
        { header: 'Coins Earned', key: 'totalCoinsEarned', width: 12 },
        { header: 'Start', key: 'startTime', width: 24 },
        { header: 'End', key: 'endTime', width: 24 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      countFn: () => adminCommunicationService.countSessionsForExport(queryParams),
      rowIteratorFn: async function* () {
        const cursor = adminCommunicationService.iterateSessionsForExport(
          queryParams,
          EXPORT_BATCH_SIZE
        );
        for await (const doc of cursor) {
          const mapped = {
            ...doc,
            caller: {
              ...doc.caller,
              name: doc.caller?.name?.trim() || 'Unknown',
            },
            listener: {
              ...doc.listener,
              name: doc.listener?.name?.trim() || 'Unknown',
            },
          };
          yield mapRow(mapped);
        }
      },
    });
  }

  // ─── Wave 2 ─────────────────────────────────────────────────────────────

  async exportRoles(_queryParams, res) {
    const query = Role.find({}).sort({ name: 1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('roles'),
      sheetName: 'Roles',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Slug', key: 'slug', width: 18 },
        { header: 'System', key: 'isSystemRole', width: 10 },
        { header: 'Active', key: 'isActive', width: 10 },
        { header: 'Permissions', key: 'permissionCount', width: 12 },
        { header: 'Description', key: 'description', width: 36 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        slug: d.slug ?? '',
        isSystemRole: d.isSystemRole ? 'Yes' : 'No',
        isActive: d.isActive !== false ? 'Yes' : 'No',
        permissionCount: Array.isArray(d.permissions) ? d.permissions.length : 0,
        description: d.description ?? '',
      }),
    });
  }

  async exportCountries(queryParams, res) {
    const filter = {};
    if (queryParams.search) {
      const s = String(queryParams.search).trim();
      filter.$or = [
        { name: { $regex: s, $options: 'i' } },
        { code: { $regex: s, $options: 'i' } },
        { dialCode: { $regex: s, $options: 'i' } },
      ];
    }
    if (queryParams.isActive !== undefined) filter.isActive = boolish(queryParams.isActive);

    const query = Country.find(filter).sort({ name: 1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('countries'),
      sheetName: 'Countries',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Code', key: 'code', width: 10 },
        { header: 'Dial Code', key: 'dialCode', width: 12 },
        { header: 'Active', key: 'isActive', width: 10 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        code: d.code ?? '',
        dialCode: d.dialCode ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
      }),
    });
  }

  async exportLanguages(queryParams, res) {
    const filter = {};
    if (queryParams.search) {
      const s = String(queryParams.search).trim();
      filter.$or = [
        { name: { $regex: s, $options: 'i' } },
        { code: { $regex: s, $options: 'i' } },
        { nativeName: { $regex: s, $options: 'i' } },
      ];
    }
    const query = Language.find(filter).sort({ name: 1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('languages'),
      sheetName: 'Languages',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Native Name', key: 'nativeName', width: 20 },
        { header: 'Code', key: 'code', width: 10 },
        { header: 'Active', key: 'isActive', width: 10 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        nativeName: d.nativeName ?? '',
        code: d.code ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
      }),
    });
  }

  async exportGifts(queryParams, res) {
    const filter = {};
    if (queryParams.q || queryParams.search) {
      const s = String(queryParams.q || queryParams.search).trim();
      if (s) filter.name = { $regex: s, $options: 'i' };
    }
    const query = Gift.find(filter).sort({ createdAt: -1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('gifts'),
      sheetName: 'Gifts',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Coin Cost', key: 'coinCost', width: 12 },
        { header: 'Active', key: 'isActive', width: 10 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        coinCost: d.coinCost ?? d.coins ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportCoinPacks(queryParams, res) {
    const filter = {};
    if (queryParams.q || queryParams.search) {
      const s = String(queryParams.q || queryParams.search).trim();
      if (s) filter.name = { $regex: s, $options: 'i' };
    }
    const query = CoinPack.find(filter).sort({ createdAt: -1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('coin_packs'),
      sheetName: 'CoinPacks',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Coins', key: 'coins', width: 12 },
        { header: 'Price', key: 'price', width: 12 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Active', key: 'isActive', width: 10 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        coins: d.coins ?? '',
        price: d.price ?? '',
        currency: d.currency ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
      }),
    });
  }

  async exportBanners(queryParams, res) {
    const filter = {};
    if (queryParams.search) {
      const s = String(queryParams.search).trim();
      if (s) filter.title = { $regex: s, $options: 'i' };
    }
    const query = Banner.find(filter).sort({ createdAt: -1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('banners'),
      sheetName: 'Banners',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Title', key: 'title', width: 28 },
        { header: 'Active', key: 'isActive', width: 10 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        title: d.title ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportAvatars(queryParams, res) {
    const filter = {};
    if (queryParams.q || queryParams.search) {
      const s = String(queryParams.q || queryParams.search).trim();
      if (s) filter.name = { $regex: s, $options: 'i' };
    }
    const query = Avatar.find(filter).sort({ createdAt: -1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('avatars'),
      sheetName: 'Avatars',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Category', key: 'category', width: 14 },
        { header: 'Active', key: 'isActive', width: 10 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        category: d.category ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
      }),
    });
  }

  async exportStickers(queryParams, res) {
    const filter = {};
    if (queryParams.search) {
      const s = String(queryParams.search).trim();
      if (s) {
        filter.$or = [
          { name: { $regex: s, $options: 'i' } },
          { tags: { $regex: s, $options: 'i' } },
        ];
      }
    }
    const query = Sticker.find(filter).sort({ createdAt: -1 }).lean();
    await streamXlsxFromQuery(res, {
      filename: exportFilename('stickers'),
      sheetName: 'Stickers',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Name', key: 'name', width: 22 },
        { header: 'Active', key: 'isActive', width: 10 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        name: d.name ?? '',
        isActive: d.isActive !== false ? 'Yes' : 'No',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportReferrals(queryParams, res) {
    await streamFromListFn(res, {
      filename: exportFilename('referrals'),
      sheetName: 'Referrals',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Referrer', key: 'referrer', width: 24 },
        { header: 'Referred', key: 'referred', width: 24 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      listFn: (page, limit) =>
        referralService.adminGetReferrals({
          ...queryParams,
          page,
          limit,
          q: queryParams.search || queryParams.q,
        }),
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? d.id ?? '',
        referrer: formatFullName(d.referrer) || d.referrerName || '',
        referred: formatFullName(d.referred) || d.referredName || '',
        status: d.status ?? '',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  async exportFeedback(queryParams, res) {
    const Feedback = (await import('../modules/feedback.model.js')).default;
    const { buildUtcCreatedAtFilter } = await import('../utils/date-filter.util.js');
    const filter = { ...buildUtcCreatedAtFilter(queryParams) };
    if (queryParams.status) filter.status = queryParams.status;
    if (queryParams.category) filter.category = queryParams.category;
    if (queryParams.search?.trim()) {
      filter.message = { $regex: queryParams.search.trim(), $options: 'i' };
    }

    const query = Feedback.find(filter)
      .select('status message createdAt')
      .sort({ createdAt: -1 })
      .lean();

    await streamXlsxFromQuery(res, {
      filename: exportFilename('feedback'),
      sheetName: 'Feedback',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Message', key: 'message', width: 40 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      query,
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? '',
        status: d.status ?? '',
        message: d.message ?? '',
        createdAt: formatExportDate(d.createdAt),
      }),
    });
  }

  /** User activity feed export */
  async exportUserActivity(queryParams, res) {
    await streamFromListFn(res, {
      filename: exportFilename('user_activity'),
      sheetName: 'UserActivity',
      columns: [
        { header: 'ID', key: 'id', width: 26 },
        { header: 'User', key: 'user', width: 22 },
        { header: 'Action', key: 'action', width: 28 },
        { header: 'Created At', key: 'createdAt', width: 24 },
      ],
      listFn: (page, limit) =>
        userService.getCustomerActivityFeed({ ...queryParams, page, limit }),
      mapRow: (d) => ({
        id: d._id?.toString?.() ?? d.id ?? '',
        user: formatFullName(d.user) || d.userName || d.name || '',
        action: d.action || d.type || d.message || '',
        createdAt: formatExportDate(d.createdAt || d.time),
      }),
    });
  }
}

export default new AdminExportService();
