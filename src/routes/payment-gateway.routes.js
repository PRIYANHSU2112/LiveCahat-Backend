import express from 'express';
import paymentGatewayController from '../controllers/payment-gateway.controller.js';
import { authenticate, restrictTo, authorize } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireObjectId } from '../middlewares/object-id.middleware.js';
import {
  createPaymentGatewaySchema,
  updatePaymentGatewaySchema,
  paymentGatewayIdParamSchema,
  paymentGatewayStatusSchema,
} from '../validators/payment-gateway.validator.js';

const router = express.Router();

router.use(authenticate, restrictTo('ADMIN'));

router.get('/', authorize('payment_gateway.read'), paymentGatewayController.list);
router.get(
  '/:id',
  authorize('payment_gateway.read'),
  requireObjectId('id'),
  validate(paymentGatewayIdParamSchema),
  paymentGatewayController.getById
);
router.post(
  '/',
  authorize('payment_gateway.create'),
  validate(createPaymentGatewaySchema),
  paymentGatewayController.create
);
router.put(
  '/:id',
  authorize('payment_gateway.update'),
  requireObjectId('id'),
  validate(updatePaymentGatewaySchema),
  paymentGatewayController.update
);
router.patch(
  '/:id/default',
  authorize('payment_gateway.update'),
  requireObjectId('id'),
  validate(paymentGatewayIdParamSchema),
  paymentGatewayController.setDefault
);
router.patch(
  '/:id/status',
  authorize('payment_gateway.update'),
  requireObjectId('id'),
  validate(paymentGatewayStatusSchema),
  paymentGatewayController.setStatus
);
router.delete(
  '/:id',
  authorize('payment_gateway.delete'),
  requireObjectId('id'),
  validate(paymentGatewayIdParamSchema),
  paymentGatewayController.remove
);

export default router;
