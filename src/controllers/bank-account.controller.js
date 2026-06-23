import BaseController from './base.controller.js';
import bankAccountService from '../services/bank-account.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class BankAccountController extends BaseController {
  addBankAccount = catchAsync(async (req, res) => {
    const data = await bankAccountService.addBankAccount(req.user._id, req.body);
    this.sendResponse(res, 201, 'Bank account added successfully', data);
  });

  getMyBankAccounts = catchAsync(async (req, res) => {
    const data = await bankAccountService.getMyBankAccounts(req.user._id);
    this.sendResponse(res, 200, 'Bank accounts fetched successfully', data);
  });

  deleteBankAccount = catchAsync(async (req, res) => {
    await bankAccountService.deleteBankAccount(req.user._id, req.params.id);
    this.sendResponse(res, 200, 'Bank account deleted successfully');
  });
}

export default new BankAccountController();
