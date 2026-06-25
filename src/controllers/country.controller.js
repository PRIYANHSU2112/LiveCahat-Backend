import BaseController from './base.controller.js';
import countryService from '../services/country.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class CountryController extends BaseController {
  getAllCountries = catchAsync(async (req, res) => {
    const countries = await countryService.getActiveCountries();
    this.sendResponse(res, 200, 'Countries fetched successfully', countries);
  });
}

export default new CountryController();
