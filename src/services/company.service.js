import companyRepository from '../repositories/company.repository.js';
import ApiError from '../utils/ApiError.js';

class CompanyService {
  /**
   * Create a new company record.
   */
  async createCompany(data) {
    return await companyRepository.create(data);
  }

  /**
   * Retrieve the primary/first company profile. Auto-creates a default if none exists.
   */
  async getCompanyProfile() {
    let company = await companyRepository.findOne({});
    if (!company) {
      // Auto-seed a default/skeleton company profile to prevent 404
      company = await companyRepository.create({
        name: 'Default Company Name',
        email: 'info@company.com',
        description: 'Company description goes here.',
      });
    }
    return company;
  }

  /**
   * Get all company records.
   */
  async getAllCompanies(query) {
    const limit = parseInt(query.limit, 10) || 10;
    const skip = (parseInt(query.page, 10) - 1) * limit || 0;
    return await companyRepository.findMany({}, '', '', { createdAt: -1 }, limit, skip);
  }

  /**
   * Get a company record by ID.
   */
  async getCompanyById(id) {
    const company = await companyRepository.findById(id);
    if (!company) {
      throw new ApiError(404, 'Company not found');
    }
    return company;
  }

  /**
   * Update a company record by ID.
   */
  async updateCompany(id, data) {
    const updatedCompany = await companyRepository.updateById(id, data);
    if (!updatedCompany) {
      throw new ApiError(404, 'Company not found');
    }
    return updatedCompany;
  }

  /**
   * Delete a company record by ID.
   */
  async deleteCompany(id) {
    const deletedCompany = await companyRepository.deleteById(id);
    if (!deletedCompany) {
      throw new ApiError(404, 'Company not found');
    }
    return deletedCompany;
  }
}

export default new CompanyService();
