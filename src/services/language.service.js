import languageRepository from '../repositories/language.repository.js';
import ApiError from '../utils/ApiError.js';

class LanguageService {
  async createLanguage(data) {
    if (data.code) {
      const existing = await languageRepository.findOne({ code: data.code.toUpperCase() });
      if (existing) {
        throw new ApiError(400, 'Language with this code already exists');
      }
    }
    return await languageRepository.create(data);
  }

  async getAllLanguages(query) {
    const filter = {};
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }
    return await languageRepository.findMany(filter, '', '', { name: 1 });
  }

  async getLanguageById(id) {
    const language = await languageRepository.findById(id);
    if (!language) {
      throw new ApiError(404, 'Language not found');
    }
    return language;
  }

  async updateLanguage(id, data) {
    if (data.code) {
      const existing = await languageRepository.findOne({ code: data.code.toUpperCase(), _id: { $ne: id } });
      if (existing) {
        throw new ApiError(400, 'Language with this code already exists');
      }
    }
    const updatedLanguage = await languageRepository.updateById(id, data);
    if (!updatedLanguage) {
      throw new ApiError(404, 'Language not found');
    }
    return updatedLanguage;
  }

  async deleteLanguage(id) {
    const deletedLanguage = await languageRepository.deleteById(id);
    if (!deletedLanguage) {
      throw new ApiError(404, 'Language not found');
    }
    return deletedLanguage;
  }
}

export default new LanguageService();
