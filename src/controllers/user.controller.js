import BaseController from './base.controller.js';
import userService from '../services/user.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class UserController extends BaseController {
  
  // Create User
  createUser = catchAsync(async (req, res, next) => {
    const user = await userService.createUser(req.body);
    this.sendResponse(res, 201, 'User created successfully', user);
  });

  // Get User by ID
  getUser = catchAsync(async (req, res, next) => {
    const user = await userService.getItemById(req.params.id);
    if (!user) {
      return this.sendError(res, 404, 'User not found');
    }
    this.sendResponse(res, 200, 'User fetched successfully', user);
  });
}

export default new UserController();
