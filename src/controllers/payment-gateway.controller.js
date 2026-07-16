import BaseController from './base.controller.js';
import catchAsync from '../utils/catchAsync.util.js';
import paymentGatewayService from '../services/payment-gateway.service.js';

class PaymentGatewayController extends BaseController {
  list = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.list();
    this.sendResponse(res, 200, 'Payment gateways fetched successfully', data);
  });

  getById = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.getById(req.params.id);
    this.sendResponse(res, 200, 'Payment gateway fetched successfully', data);
  });

  create = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.create(req.body, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 201, 'Payment gateway created successfully', data);
  });

  update = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.update(req.params.id, req.body, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Payment gateway updated successfully', data);
  });

  setDefault = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.setDefault(req.params.id, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Default payment gateway updated successfully', data);
  });

  setStatus = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.setStatus(
      req.params.id,
      req.body.isEnabled,
      req.user,
      { ip: req.ip, userAgent: req.get('user-agent') }
    );
    this.sendResponse(res, 200, 'Payment gateway status updated successfully', data);
  });

  remove = catchAsync(async (req, res) => {
    const data = await paymentGatewayService.remove(req.params.id, req.user, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    this.sendResponse(res, 200, 'Payment gateway deleted successfully', data);
  });
}

export default new PaymentGatewayController();
