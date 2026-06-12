import BaseController from './base.controller.js';
import giftService from '../services/gift.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class GiftController extends BaseController {
  createGift = catchAsync(async (req, res) => {
    const gift = await giftService.createGift(req.body);
    this.sendResponse(res, 201, 'Gift created successfully', gift);
  });

  updateGift = catchAsync(async (req, res) => {
    const gift = await giftService.updateGift(req.params.id, req.body);
    this.sendResponse(res, 200, 'Gift updated successfully', gift);
  });

  deleteGift = catchAsync(async (req, res) => {
    await giftService.deleteGift(req.params.id);
    this.sendResponse(res, 200, 'Gift deleted successfully');
  });

  getAllGifts = catchAsync(async (req, res) => {
    const gifts = await giftService.getAllGifts(req.query);
    this.sendResponse(res, 200, 'Gifts fetched successfully', gifts);
  });

  getGiftById = catchAsync(async (req, res) => {
    const gift = await giftService.getGiftById(req.params.id);
    this.sendResponse(res, 200, 'Gift details fetched successfully', gift);
  });

  sendGift = catchAsync(async (req, res) => {
    // senderId and senderRole are extracted from authenticate middleware
    const senderId = req.user._id;
    const senderRole = req.user.type; // CUSTOMER or ADMIN

    const transaction = await giftService.sendGift(senderId, senderRole, req.body);
    this.sendResponse(res, 201, 'Gift sent successfully', transaction);
  });

  getSentGiftsHistory = catchAsync(async (req, res) => {
    const history = await giftService.getSentGiftsHistory(req.user._id, req.query);
    this.sendResponse(res, 200, 'Sent gifts history fetched successfully', history);
  });

  getReceivedGiftsHistory = catchAsync(async (req, res) => {
    const history = await giftService.getReceivedGiftsHistory(req.user._id, req.query);
    this.sendResponse(res, 200, 'Received gifts history fetched successfully', history);
  });

  getAdminGiftAnalytics = catchAsync(async (req, res) => {
    const analytics = await giftService.getAdminGiftAnalytics();
    this.sendResponse(res, 200, 'Admin gift analytics fetched successfully', analytics);
  });
}

export default new GiftController();
