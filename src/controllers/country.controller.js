import BaseController from './base.controller.js';
import countryService from '../services/country.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class CountryController extends BaseController {
  getAllCountries = catchAsync(async (req, res) => {
    const countries = await countryService.getActiveCountries();
    this.sendResponse(res, 200, 'Countries fetched successfully', countries);
  });

  getAdminStats = catchAsync(async (req, res) => {
    const data = await countryService.getAdminStats();
    this.sendResponse(res, 200, 'Country stats fetched successfully', data);
  });

  getAdminCountries = catchAsync(async (req, res) => {
    const countries = await countryService.getAdminCountries(req.query);
    this.sendResponse(res, 200, 'Countries fetched successfully', countries);
  });

  getCountryById = catchAsync(async (req, res) => {
    const country = await countryService.getCountryById(req.params.id);
    this.sendResponse(res, 200, 'Country fetched successfully', country);
  });

  createCountry = catchAsync(async (req, res) => {
    const country = await countryService.createCountry(req.body);
    this.sendResponse(res, 201, 'Country created successfully', country);
  });

  updateCountry = catchAsync(async (req, res) => {
    const country = await countryService.updateCountry(req.params.id, req.body);
    this.sendResponse(res, 200, 'Country updated successfully', country);
  });

  toggleCountry = catchAsync(async (req, res) => {
    const country = await countryService.toggleCountryStatus(req.params.id);
    const status = country.isActive ? 'activated' : 'deactivated';
    this.sendResponse(res, 200, `Country ${status} successfully`, country);
  });

  deleteCountry = catchAsync(async (req, res) => {
    await countryService.deleteCountry(req.params.id);
    this.sendResponse(res, 200, 'Country deleted successfully');
  });
}

export default new CountryController();
