import BaseController from './base.controller.js';
import languageService from '../services/language.service.js';
import catchAsync from '../utils/catchAsync.util.js';

class LanguageController extends BaseController {
  
  createLanguage = catchAsync(async (req, res) => {
    const language = await languageService.createLanguage(req.body);
    this.sendResponse(res, 201, 'Language created successfully', language);
  });

  getAllLanguages = catchAsync(async (req, res) => {
    const languages = await languageService.getAllLanguages(req.query);
    this.sendResponse(res, 200, 'Languages fetched successfully', languages);
  });

  getLanguageById = catchAsync(async (req, res) => {
    const language = await languageService.getLanguageById(req.params.id);
    this.sendResponse(res, 200, 'Language fetched successfully', language);
  });

  updateLanguage = catchAsync(async (req, res) => {
    const language = await languageService.updateLanguage(req.params.id, req.body);
    this.sendResponse(res, 200, 'Language updated successfully', language);
  });

  deleteLanguage = catchAsync(async (req, res) => {
    await languageService.deleteLanguage(req.params.id);
    this.sendResponse(res, 200, 'Language deleted successfully');
  });
}

export default new LanguageController();
