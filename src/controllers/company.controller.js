import BaseController from './base.controller.js';
import companyService from '../services/company.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class CompanyController extends BaseController {
  createCompany = catchAsync(async (req, res) => {
    const company = await companyService.createCompany(req.body);
    this.sendResponse(res, 201, 'Company created successfully', company);
  });

  getCompanyProfile = catchAsync(async (req, res) => {
    const company = await companyService.getCompanyProfile();
    this.sendResponse(res, 200, 'Company profile fetched successfully', company);
  });

  getAdminProfile = catchAsync(async (req, res) => {
    const company = await companyService.getAdminProfile();
    this.sendResponse(res, 200, 'Company profile fetched successfully', company);
  });

  getAdminStats = catchAsync(async (req, res) => {
    const stats = await companyService.getAdminStats();
    this.sendResponse(res, 200, 'Company stats fetched successfully', stats);
  });

  upsertAdminProfile = catchAsync(async (req, res) => {
    const company = await companyService.upsertAdminProfile(req.body);
    this.sendResponse(res, 200, 'Company profile saved successfully', company);
  });

  getAllCompanies = catchAsync(async (req, res) => {
    const companies = await companyService.getAllCompanies(req.query);
    this.sendResponse(res, 200, 'Companies fetched successfully', companies);
  });

  getCompanyById = catchAsync(async (req, res) => {
    const company = await companyService.getCompanyById(req.params.id);
    this.sendResponse(res, 200, 'Company fetched successfully', company);
  });

  updateCompany = catchAsync(async (req, res) => {
    const company = await companyService.updateCompany(req.params.id, req.body);
    this.sendResponse(res, 200, 'Company updated successfully', company);
  });

  deleteCompany = catchAsync(async (req, res) => {
    await companyService.deleteCompany(req.params.id);
    this.sendResponse(res, 200, 'Company deleted successfully');
  });
}

export default new CompanyController();
