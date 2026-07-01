import mongoose from 'mongoose';
import User from '../modules/user.model.js';
import communicationSessionRepository from '../repositories/communication-session.repository.js';

const CUSTOMER_MATCH = {
  type: 'CUSTOMER',
  isDeleted: false,
  isBlocked: false,
};

const CUSTOMER_PROJECT = {
  firstName: 1,
  lastName: 1,
  profileImage: 1,
  gender: 1,
  countryCode: 1,
  currentLevel: 1,
  totalXp: 1,
  isOnline: 1,
  createdAt: 1,
};

class ListenerHomeRepository {
  /**
   * Fetch customer profiles by IDs preserving order.
   */
  async findCustomersByIdsOrdered(customerIds) {
    if (!customerIds?.length) return [];

    const objectIds = customerIds.map((id) => new mongoose.Types.ObjectId(id));
    const users = await User.find({ _id: { $in: objectIds }, ...CUSTOMER_MATCH })
      .select(CUSTOMER_PROJECT)
      .lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));
    return customerIds.map((id) => userMap.get(id.toString())).filter(Boolean);
  }

  /**
   * Last session timestamp per customer for a listener.
   */
  async getLastInteractionMap(listenerId, customerIds) {
    if (!customerIds?.length) return new Map();

    const listenerObjectId = new mongoose.Types.ObjectId(listenerId);
    const customerObjectIds = customerIds.map((id) => new mongoose.Types.ObjectId(id));

    const rows = await communicationSessionRepository.model.aggregate([
      {
        $match: {
          listenerId: listenerObjectId,
          callerId: { $in: customerObjectIds },
        },
      },
      {
        $group: {
          _id: '$callerId',
          lastInteractionAt: { $max: '$createdAt' },
        },
      },
    ]);

    return new Map(rows.map((r) => [r._id.toString(), r.lastInteractionAt]));
  }

  /**
   * Customers with no communication session with this listener (Mongo anti-join).
   */
  async findNewCustomersForListener(listenerId, skip, limit) {
    const listenerObjectId = new mongoose.Types.ObjectId(listenerId);

    const [result] = await User.aggregate([
      { $match: CUSTOMER_MATCH },
      {
        $lookup: {
          from: 'communicationsessions',
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$callerId', '$$customerId'] },
                    { $eq: ['$listenerId', listenerObjectId] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'withListener',
        },
      },
      { $match: { withListener: { $size: 0 } } },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            { $project: CUSTOMER_PROJECT },
          ],
        },
      },
    ]);

    const total = result?.metadata?.[0]?.total ?? 0;
    const data = result?.data ?? [];
    return { total, data };
  }

  /**
   * All customers ranked by level (popular section).
   */
  async findPopularCustomers(skip, limit) {
    const { total, data } = await this._paginateCustomers(
      CUSTOMER_MATCH,
      { currentLevel: -1, totalXp: -1, createdAt: -1 },
      skip,
      limit
    );
    return { total, data };
  }

  async _paginateCustomers(match, sort, skip, limit) {
    const [result] = await User.aggregate([
      { $match: match },
      { $sort: sort },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit },
            { $project: CUSTOMER_PROJECT },
          ],
        },
      },
    ]);

    return {
      total: result?.metadata?.[0]?.total ?? 0,
      data: result?.data ?? [],
    };
  }
}

export default new ListenerHomeRepository();
