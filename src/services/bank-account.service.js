import bankAccountRepository from '../repositories/bank-account.repository.js';
import ApiError from '../utils/ApiError.js';
import { getCache, setCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

const CACHE_NS = 'bank_accounts';

/**
 * Mask an account number / UPI id for display in lists and statements.
 */
export const maskAccount = (acc) => {
  if (!acc) return '';
  if (acc.methodType === 'BANK' && acc.accountNumber) {
    const last4 = acc.accountNumber.slice(-4);
    return `******${last4}`;
  }
  if (acc.methodType === 'UPI' && acc.upiId) {
    return acc.upiId;
  }
  return '';
};

/**
 * Build a frozen snapshot of a bank account for the withdrawal record.
 */
export const buildBankSnapshot = (acc) => ({
  methodType: acc.methodType,
  maskedAccount: maskAccount(acc),
  holderName: acc.methodType === 'BANK' ? acc.accountHolderName : acc.payeeName,
  bankName: acc.bankName || null,
  ifscCode: acc.ifscCode || null,
});

class BankAccountService {
  async addBankAccount(userId, body) {
    const account = await bankAccountRepository.create({ ...body, userId });
    await bumpCacheVersion(CACHE_NS);
    return account;
  }

  async getMyBankAccounts(userId) {
    const version = await getCacheVersion(CACHE_NS);
    const cacheKey = `${CACHE_NS}:user:${userId}:v${version}`;

    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const accounts = await bankAccountRepository.findMany(
      { userId },
      '',
      '',
      { createdAt: -1 },
      100,
      0
    );

    await setCache(cacheKey, accounts, 600); // 10 min
    return accounts;
  }

  async deleteBankAccount(userId, id) {
    const account = await bankAccountRepository.findById(id);
    if (!account) throw new ApiError(404, 'Bank account not found');
    if (account.userId.toString() !== userId.toString()) {
      throw new ApiError(403, 'You can only delete your own bank accounts.');
    }

    await bankAccountRepository.deleteById(id);
    await bumpCacheVersion(CACHE_NS);
    return { deleted: true };
  }
}

export default new BankAccountService();
