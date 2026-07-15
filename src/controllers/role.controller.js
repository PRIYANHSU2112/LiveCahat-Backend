import BaseController from './base.controller.js';
import catchAsync from '../utils/catchAsync.util.js';
import roleService from '../services/role.service.js';
import permissionService from '../services/permission.service.js';
import auditLogListService from '../services/audit-log-list.service.js';

class RoleController extends BaseController {
  list = catchAsync(async (req, res) => {
    const data = await roleService.listRoles(req.query);
    this.sendResponse(res, 200, 'Roles fetched successfully', data);
  });

  stats = catchAsync(async (req, res) => {
    const data = await roleService.getStats();
    this.sendResponse(res, 200, 'Role stats fetched successfully', data);
  });

  policies = catchAsync(async (req, res) => {
    const data = await roleService.listPolicies();
    this.sendResponse(res, 200, 'Access policies fetched successfully', data);
  });

  getById = catchAsync(async (req, res) => {
    const data = await roleService.getById(req.params.id);
    this.sendResponse(res, 200, 'Role fetched successfully', data);
  });

  create = catchAsync(async (req, res) => {
    const data = await roleService.create(req.body, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 201, 'Role created successfully', data);
  });

  update = catchAsync(async (req, res) => {
    const data = await roleService.update(req.params.id, req.body, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Role updated successfully', data);
  });

  remove = catchAsync(async (req, res) => {
    const data = await roleService.remove(req.params.id, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Role deleted successfully', data);
  });

  getMatrix = catchAsync(async (req, res) => {
    const data = await roleService.getMatrix(req.params.id);
    this.sendResponse(res, 200, 'Role permission matrix fetched successfully', data);
  });

  putMatrix = catchAsync(async (req, res) => {
    const data = await roleService.putMatrix(req.params.id, req.body.cells, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Role permission matrix updated successfully', data);
  });

  getMembers = catchAsync(async (req, res) => {
    const data = await roleService.getMembers(req.params.id, req.query);
    this.sendResponse(res, 200, 'Role members fetched successfully', data);
  });

  assignAdminRole = catchAsync(async (req, res) => {
    const data = await roleService.assignRoleToAdmin(req.params.id, req.body.roleId, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Admin role assigned successfully', data);
  });

  listPermissions = catchAsync(async (req, res) => {
    const data = await permissionService.list(req.query);
    this.sendResponse(res, 200, 'Permissions fetched successfully', data);
  });

  matrixMeta = catchAsync(async (req, res) => {
    const data = permissionService.getMatrixMeta();
    this.sendResponse(res, 200, 'Permission matrix metadata fetched successfully', data);
  });

  listAuditLogs = catchAsync(async (req, res) => {
    const data = await auditLogListService.list(req.query);
    this.sendResponse(res, 200, 'Audit logs fetched successfully', data);
  });
}

export default new RoleController();
