import express from 'express';
import reportController from '../controllers/report.controller.js';
import { authenticate, restrictTo } from '../middlewares/auth.middleware.js';
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
  validate(listReportReasonsQuerySchema),
  reportController.getAllReasons
);
router.post(
  '/reasons',
  restrictTo('ADMIN'),
  validate(createReportReasonSchema),
  reportController.createReason
);
router.patch(
  '/reasons/:id/toggle',
  restrictTo('ADMIN'),
  validate(idParamSchema),
  validate(toggleReportReasonSchema),
  reportController.toggleReason
);
router.patch(
  '/reasons/:id',
  restrictTo('ADMIN'),
  validate(idParamSchema),
  validate(updateReportReasonSchema),
  reportController.updateReason
);
router.delete(
  '/reasons/:id',
  restrictTo('ADMIN'),
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
router.get('/stats', validate(reportStatsQuerySchema), reportController.getStats);
router.get('/', validate(listReportsQuerySchema), reportController.getAllReports);
router.get('/:id', validate(idParamSchema), reportController.getReportById);
router.patch(
  '/:id/moderate',
  validate(idParamSchema),
  validate(moderateReportSchema),
  reportController.moderateReport
);

export default router;
