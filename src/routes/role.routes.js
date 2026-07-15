import express from 'express';
import roleController from '../controllers/role.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  listRolesQuerySchema,
  createRoleSchema,
  updateRoleSchema,
  roleIdParamSchema,
  putMatrixSchema,
  listAuditLogsQuerySchema,
} from '../validators/role.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get('/stats', authorize('role.read'), roleController.stats);
router.get('/policies', authorize('role.read'), roleController.policies);
router.get('/', authorize('role.read'), validate(listRolesQuerySchema), roleController.list);
router.post('/', authorize('role.create'), validate(createRoleSchema), roleController.create);
router.get('/:id', authorize('role.read'), validate(roleIdParamSchema), roleController.getById);
router.patch('/:id', authorize('role.update'), validate(updateRoleSchema), roleController.update);
router.delete('/:id', authorize('role.delete'), validate(roleIdParamSchema), roleController.remove);
router.get(
  '/:id/matrix',
  authorize('role.read'),
  validate(roleIdParamSchema),
  roleController.getMatrix
);
router.put('/:id/matrix', authorize('role.update'), validate(putMatrixSchema), roleController.putMatrix);
router.get(
  '/:id/members',
  authorize('role.read'),
  validate(roleIdParamSchema),
  roleController.getMembers
);

export default router;

/** Separate mounts helpers used from index.routes.js */
export const permissionRouter = express.Router();
permissionRouter.use(authenticate, restrictTo('ADMIN'));
permissionRouter.get('/', authorize('permission.read'), roleController.listPermissions);
permissionRouter.get('/matrix-meta', authorize('permission.read'), roleController.matrixMeta);

export const auditLogRouter = express.Router();
auditLogRouter.use(authenticate, restrictTo('ADMIN'));
auditLogRouter.get(
  '/',
  authorize('audit_log.read'),
  validate(listAuditLogsQuerySchema),
  roleController.listAuditLogs
);
