import mongoose from 'mongoose';
import agentSettlementRepository from '../repositories/agent-settlement.repository.js';
import agentRepository from '../repositories/agent.repository.js';
import withdrawalService from './withdrawal.service.js';
import AgentSettlement from '../modules/agent-settlement.model.js';
import Wallet from '../modules/wallet.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import User from '../modules/user.model.js';
import ListenerProfile from '../modules/listener-profile.model.js';
import ApiError from '../utils/ApiError.js';
import { formatPaginatedResponse, getPaginationOptions } from '../utils/pagination.util.js';
import { getCache, setCache, getCacheVersion, bumpCacheVersion } from '../utils/redis.util.js';

const CACHE_TTL = 60;
const CACHE_NS = 'agent:settlements';

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const commissionFrom = (revenue, rate) => round((revenue * rate) / 100);

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(weeksAgo = 1) {
  const currentWeekStart = startOfWeek(new Date());
  const end = new Date(currentWeekStart);
  end.setDate(end.getDate() - 1 - (weeksAgo - 1) * 7);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function formatCycleLabel(date) {
  const d = new Date(date);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function daysUntilNextCycle() {
  const now = new Date();
  const nextMonday = startOfWeek(now);
  if (now >= nextMonday) {
    nextMonday.setDate(nextMonday.getDate() + 7);
  }
  return Math.max(0, Math.ceil((nextMonday.getTime() - now.getTime()) / 86400000));
}

function mapSettlementRow(doc) {
  return {
    id: doc._id?.toString() ?? doc.id,
    settlementCode: doc.settlementCode,
    cycle: doc.cycleLabel,
    cycleLabel: doc.cycleLabel,
    amount: doc.amountCoins,
    amountCoins: doc.amountCoins,
    amountInr: doc.amountInr,
    listenerCount: doc.listenerCount ?? 0,
    commissionRate: doc.commissionRate ?? 0,
    status: doc.status === 'COMPLETED' ? 'completed' : doc.status === 'PENDING' ? 'pending' : 'failed',
    date: doc.settledAt ?? doc.createdAt,
    settledAt: doc.settledAt,
    createdAt: doc.createdAt,
  };
}

class AgentSettlementService {
  async bumpCache(agentId) {
    await bumpCacheVersion(`${CACHE_NS}:${agentId}`);
  }

  async getStats(agentId) {
    const version = await getCacheVersion(`${CACHE_NS}:${agentId}`);
    const cacheKey = `${CACHE_NS}:stats:v${version}:${agentId}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    const agentObjectId = new mongoose.Types.ObjectId(agentId);
    const [agg] = await agentSettlementRepository.aggregate([
      { $match: { agentId: agentObjectId, status: 'COMPLETED' } },
      {
        $group: {
          _id: null,
          totalSettledCoins: { $sum: '$amountCoins' },
          totalSettledInr: { $sum: '$amountInr' },
          completedCycles: { $sum: 1 },
          avgCycleCoins: { $avg: '$amountCoins' },
        },
      },
    ]);

    const pendingCount = await agentSettlementRepository.countDocuments({
      agentId,
      status: 'PENDING',
    });

    const payload = {
      totalSettledCoins: round(agg?.totalSettledCoins ?? 0),
      totalSettledInr: round2(agg?.totalSettledInr ?? 0),
      completedCycles: agg?.completedCycles ?? 0,
      avgCycleCoins: round(agg?.avgCycleCoins ?? 0),
      pendingCycles: pendingCount,
      nextCycleInDays: daysUntilNextCycle(),
      nextCycleAt: (() => {
        const d = startOfWeek(new Date());
        if (new Date() >= d) d.setDate(d.getDate() + 7);
        return d.toISOString();
      })(),
    };

    await setCache(cacheKey, payload, CACHE_TTL);
    return payload;
  }

  async getList(agentId, query = {}) {
    const { page, limit, skip, sort } = getPaginationOptions({
      sortBy: 'cycleEnd',
      sortOrder: 'desc',
      ...query,
    });

    const filter = { agentId };
    if (query.status && query.status !== 'all') {
      const statusMap = {
        completed: 'COMPLETED',
        pending: 'PENDING',
        failed: 'FAILED',
      };
      filter.status = statusMap[query.status] ?? query.status.toUpperCase();
    }

    const [docs, total] = await Promise.all([
      agentSettlementRepository.findMany(filter, '', '', sort, limit, skip),
      agentSettlementRepository.countDocuments(filter),
    ]);

    return formatPaginatedResponse(docs.map(mapSettlementRow), total, page, limit);
  }

  async getById(agentId, id) {
    const doc = await agentSettlementRepository.findOne({ _id: id, agentId });
    if (!doc) throw new ApiError(404, 'Settlement not found');
    return mapSettlementRow(doc);
  }

  async runSettlements(adminId, { agentId, weeksAgo = 1 } = {}) {
    const agents = agentId
      ? [{ _id: agentId }]
      : await User.find({ type: 'AGENT', isDeleted: { $ne: true } }).select('_id').lean();

    const results = [];
    for (const agent of agents) {
      try {
        const settlement = await this._settleAgentWeek(agent._id.toString(), adminId, weeksAgo);
        if (settlement) results.push(settlement);
      } catch (err) {
        results.push({ agentId: agent._id.toString(), error: err.message });
      }
    }
    return { processed: results.length, results };
  }

  async _settleAgentWeek(agentId, adminId, weeksAgo = 1) {
    const { start, end } = getWeekRange(weeksAgo);
    const cycleLabel = formatCycleLabel(start);

    const existing = await agentSettlementRepository.findOne({
      agentId,
      cycleLabel,
    });
    if (existing?.status === 'COMPLETED') return null;

    const [listenerIds, commissionRate] = await Promise.all([
      agentRepository.getListenerIdsForAgent(agentId),
      agentRepository.getAgentCommissionRate(agentId),
    ]);

    if (!listenerIds.length || commissionRate <= 0) return null;

    const earnings = await agentRepository.sumEarnings(listenerIds, start, end);
    const amountCoins = commissionFrom(earnings.total, commissionRate);
    if (amountCoins <= 0) return null;

    const config = await withdrawalService.getConfig();
    const rate = config.conversionInr / config.conversionCoins;
    const amountInr = round2(amountCoins * rate);

    const listenerCount = await ListenerProfile.countDocuments({
      createdByAgentId: agentId,
      kycStatus: 'APPROVED',
    });

    const settlementCode = `STL-${cycleLabel.replace('-W', '')}-${String(agentId).slice(-6).toUpperCase()}`;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      let settlement = existing;
      if (!settlement) {
        const [created] = await AgentSettlement.create(
          [
            {
              agentId,
              settlementCode,
              cycleLabel,
              cycleStart: start,
              cycleEnd: end,
              listenerEarningsTotal: earnings.total,
              commissionRate,
              amountCoins,
              amountInr,
              listenerCount,
              status: 'PENDING',
            },
          ],
          { session }
        );
        settlement = created;
      }

      let wallet = await Wallet.findOne({ userId: agentId }).session(session);
      if (!wallet) {
        wallet = new Wallet({
          userId: agentId,
          coinBalance: 0,
          totalRecharge: 0,
          totalSpent: 0,
          totalEarned: 0,
          totalWithdrawn: 0,
        });
      }

      wallet.coinBalance += amountCoins;
      wallet.totalEarned += amountCoins;
      await wallet.save({ session });

      const [coinTx] = await CoinTransaction.create(
        [
          {
            userId: agentId,
            type: 'CREDIT',
            amount: amountCoins,
            balanceAfter: wallet.coinBalance,
            referenceType: 'SETTLEMENT',
            referenceId: settlement._id,
            description: `Commission settlement ${cycleLabel}`,
          },
        ],
        { session }
      );

      settlement.status = 'COMPLETED';
      settlement.coinTransactionId = coinTx._id;
      settlement.processedBy = adminId;
      settlement.settledAt = new Date();
      settlement.amountCoins = amountCoins;
      settlement.amountInr = amountInr;
      settlement.listenerEarningsTotal = earnings.total;
      await settlement.save({ session });

      await session.commitTransaction();
      session.endSession();

      await Promise.all([
        this.bumpCache(agentId),
        bumpCacheVersion(`coin_transactions:user:${agentId}`),
        bumpCacheVersion(`wallet:user:${agentId}`),
      ]);

      return mapSettlementRow(settlement.toObject ? settlement.toObject() : settlement);
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
}

export default new AgentSettlementService();
