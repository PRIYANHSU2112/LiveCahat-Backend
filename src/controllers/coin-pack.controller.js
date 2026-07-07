import BaseController from './base.controller.js';
import coinPackService from '../services/coin-pack.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class CoinPackController extends BaseController {

  createCoinPack = catchAsync(async (req, res) => {
    const coinPack = await coinPackService.createCoinPack(req.body);
    this.sendResponse(res, 201, 'Coin pack created successfully', coinPack);
  });

  getAllCoinPacks = catchAsync(async (req, res) => {
    const forAdmin = req.user && req.user.type === 'ADMIN';
    const coinPacks = await coinPackService.getAllCoinPacks(req.query, forAdmin);
    this.sendResponse(res, 200, 'Coin packs fetched successfully', coinPacks);
  });

  getAdminCoinPacks = catchAsync(async (req, res) => {
    const data = await coinPackService.getAdminCoinPacks(req.query);
    this.sendResponse(res, 200, 'Admin coin packs fetched successfully', data);
  });

  getAdminStats = catchAsync(async (req, res) => {
    const data = await coinPackService.getAdminStats();
    this.sendResponse(res, 200, 'Coin pack stats fetched successfully', data);
  });

  getCoinPackById = catchAsync(async (req, res) => {
    const coinPack = await coinPackService.getCoinPackById(req.params.id);
    this.sendResponse(res, 200, 'Coin pack fetched successfully', coinPack);
  });

  updateCoinPack = catchAsync(async (req, res) => {
    const coinPack = await coinPackService.updateCoinPack(req.params.id, req.body);
    this.sendResponse(res, 200, 'Coin pack updated successfully', coinPack);
  });

  toggleCoinPack = catchAsync(async (req, res) => {
    const coinPack = await coinPackService.toggleCoinPackStatus(req.params.id);
    const status = coinPack.isActive ? 'activated' : 'deactivated';
    this.sendResponse(res, 200, `Coin pack ${status} successfully`, coinPack);
  });

  deleteCoinPack = catchAsync(async (req, res) => {
    await coinPackService.deleteCoinPack(req.params.id);
    this.sendResponse(res, 200, 'Coin pack deleted successfully');
  });
}

export default new CoinPackController();
