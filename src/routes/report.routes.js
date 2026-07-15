import express from 'express';
import reportController from '../controllers/report.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createReportReasonSchema,
  updateReportReasonSchema,
  toggleReportReasonSchema,
  listReportReasonsQuerySchema,
  createReportSchema,
  listReportsQuerySchema,
  reportStatsQuerySchema,
  moderateReportSchema,
  idParamSchema,
} from '../validators/report.validator.js';

const router = express.Router();

router.use(authenticate);

router.get('/reasons', restrictTo('CUSTOMER', 'LISTENER'), reportController.getActiveReasons);
router.get(
  '/reasons/admin',
  restrictTo('ADMIN'),
  authorize('report_reason.read'),
  validate(listReportReasonsQuerySchema),
  reportController.getAllReasons
);
router.post(
  '/reasons',
  restrictTo('ADMIN'),
  authorize('report_reason.create'),
  validate(createReportReasonSchema),
  reportController.createReason
);
router.patch(
  '/reasons/:id/toggle',
  restrictTo('ADMIN'),
  authorize('report_reason.update'),
  validate(idParamSchema),
  validate(toggleReportReasonSchema),
  reportController.toggleReason
);
router.patch(
  '/reasons/:id',
  restrictTo('ADMIN'),
  authorize('report_reason.update'),
  validate(idParamSchema),
  validate(updateReportReasonSchema),
  reportController.updateReason
);
router.delete(
  '/reasons/:id',
  restrictTo('ADMIN'),
  authorize('report_reason.delete'),
  validate(idParamSchema),
  reportController.deleteReason
);

router.post('/', restrictTo('CUSTOMER', 'LISTENER'), validate(createReportSchema), reportController.createReport);
router.get('/me', restrictTo('CUSTOMER', 'LISTENER'), validate(listReportsQuerySchema), reportController.getMyReports);
router.get(
  '/me/:id',
  restrictTo('CUSTOMER', 'LISTENER'),
  validate(idParamSchema),
  reportController.getMyReportById
);

router.use(restrictTo('ADMIN'));
router.get('/stats', authorize('report.stats.view'), validate(reportStatsQuerySchema), reportController.getStats);
router.get('/', authorize('report.read'), validate(listReportsQuerySchema), reportController.getAllReports);
router.get('/:id', authorize('report.read'), validate(idParamSchema), reportController.getReportById);
router.patch(
  '/:id/moderate',
  authorize('report.moderate'),
  validate(idParamSchema),
  validate(moderateReportSchema),
  reportController.moderateReport
);

export default router;
