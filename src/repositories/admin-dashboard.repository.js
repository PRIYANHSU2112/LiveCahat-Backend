import mongoose from 'mongoose';
import ListenerProfile from '../modules/listener-profile.model.js';
import SessionSegment from '../modules/session-segment.model.js';
import CommunicationSession from '../modules/communication-session.model.js';
import Withdrawal from '../modules/withdrawal.model.js';
import { DASHBOARD_TZ } from '../utils/date.util.js';

const periodMatch = (start, end) => ({ createdAt: { $gte: start, $lte: end } });

const userLookup = (localField, as) => ({
  $lookup: {
    from: 'users',
    localField,
    foreignField: '_id',
    as,
    pipeline: [{ $project: { firstName: 1, lastName: 1, profileImage: 1 } }],
  },
});

const latestSegmentLookup = () => ({
  $lookup: {
    from: 'sessionsegments',
    let: { sid: '$_id' },
    pipeline: [
      { $match: { $expr: { $eq: ['$sessionId', '$$sid'] } } },
      { $sort: { startTime: -1 } },
      { $limit: 1 },
    ],
    as: 'currentSegment',
  },
});

class AdminDashboardRepository {
  async getPulseCounts() {
    const [onlineListeners, busyListeners, modeRows] = await Promise.all([
      ListenerProfile.countDocuments({ kycStatus: 'APPROVED', availability: 'ONLINE' }),
      ListenerProfile.countDocuments({ kycStatus: 'APPROVED', availability: 'BUSY' }),
      SessionSegment.aggregate([
        { $match: { status: 'ONGOING' } },
        { $group: { _id: '$mode', count: { $sum: 1 } } },
      ]).allowDiskUse(false),
    ]);

    const byMode = { chat: 0, audio: 0, video: 0 };
    for (const row of modeRows) {
      if (row._id === 'CHAT') byMode.chat = row.count;
      if (row._id === 'AUDIO') byMode.audio = row.count;
      if (row._id === 'VIDEO') byMode.video = row.count;
    }

    return {
      onlineListeners,
      busyListeners,
      activeChatSessions: byMode.chat,
      activeVoiceSessions: byMode.audio,
      activeVideoSessions: byMode.video,
    };
  }

  async getPendingPeriodTotals(start, end, previousStart, previousEnd) {
    const [kycFacet, withdrawalFacet] = await Promise.all([
      ListenerProfile.aggregate([
        {
          $facet: {
            pendingCurrent: [{ $match: { kycStatus: 'PENDING' } }, { $count: 'n' }],
            pendingPrevious: [
              {
                $match: {
                  kycStatus: 'PENDING',
                  createdAt: { $lte: previousEnd },
                },
              },
              { $count: 'n' },
            ],
            newPendingCurrent: [
              { $match: { kycStatus: 'PENDING', ...periodMatch(start, end) } },
              { $count: 'n' },
            ],
            newPendingPrevious: [
              {
                $match: {
                  kycStatus: 'PENDING',
                  ...periodMatch(previousStart, previousEnd),
                },
              },
              { $count: 'n' },
            ],
          },
        },
      ]).allowDiskUse(false),
      Withdrawal.aggregate([
        {
          $facet: {
            pendingSumCurrent: [
              { $match: { status: 'PENDING' } },
              { $group: { _id: null, totalNetInr: { $sum: '$netInr' }, count: { $sum: 1 } } },
            ],
            newPendingCurrent: [
              { $match: { status: 'PENDING', ...periodMatch(start, end) } },
              { $group: { _id: null, totalNetInr: { $sum: '$netInr' }, count: { $sum: 1 } } },
            ],
            newPendingPrevious: [
              {
                $match: {
                  status: 'PENDING',
                  ...periodMatch(previousStart, previousEnd),
                },
              },
              { $group: { _id: null, totalNetInr: { $sum: '$netInr' }, count: { $sum: 1 } } },
            ],
          },
        },
      ]).allowDiskUse(false),
    ]);

    const kRow = kycFacet[0] ?? {};
    const wRow = withdrawalFacet[0] ?? {};

    return {
      kycPendingCurrent: kRow.pendingCurrent?.[0]?.n ?? 0,
      kycPendingPrevious: kRow.pendingPrevious?.[0]?.n ?? 0,
      kycNewPendingCurrent: kRow.newPendingCurrent?.[0]?.n ?? 0,
      kycNewPendingPrevious: kRow.newPendingPrevious?.[0]?.n ?? 0,
      withdrawalPendingInr: wRow.pendingSumCurrent?.[0]?.totalNetInr ?? 0,
      withdrawalPendingCount: wRow.pendingSumCurrent?.[0]?.count ?? 0,
      withdrawalNewPendingInr: wRow.newPendingCurrent?.[0]?.totalNetInr ?? 0,
      withdrawalNewPendingPreviousInr: wRow.newPendingPrevious?.[0]?.totalNetInr ?? 0,
    };
  }

  async getCompletedSessionsByMode(start, end, previousStart, previousEnd) {
    const [rows] = await SessionSegment.aggregate([
      {
        $facet: {
          current: [
            { $match: { status: 'COMPLETED', ...periodMatch(start, end) } },
            { $group: { _id: '$mode', count: { $sum: 1 } } },
          ],
          previous: [
            {
              $match: {
                status: 'COMPLETED',
                ...periodMatch(previousStart, previousEnd),
              },
            },
            { $group: { _id: '$mode', count: { $sum: 1 } } },
          ],
        },
      },
    ]).allowDiskUse(false);

    const toMap = (list) => {
      const map = { CHAT: 0, AUDIO: 0, VIDEO: 0 };
      for (const row of list ?? []) map[row._id] = row.count;
      return map;
    };

    return {
      current: toMap(rows?.current),
      previous: toMap(rows?.previous),
    };
  }

  async getPeakHoursSeries(start, end) {
    // Aggregate segments directly — avoids session→all-segments $lookup/unwind.
    const rows = await SessionSegment.aggregate([
      {
        $match: {
          status: 'COMPLETED',
          startTime: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            hour: { $hour: { date: '$startTime', timezone: DASHBOARD_TZ } },
            mode: '$mode',
          },
          count: { $sum: 1 },
        },
      },
    ]).allowDiskUse(false);

    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      name: `${String(hour).padStart(2, '0')}:00`,
      hour,
      chats: 0,
      voice: 0,
      video: 0,
    }));

    for (const row of rows) {
      const hour = row._id?.hour ?? 0;
      const bucket = buckets[hour];
      if (!bucket) continue;
      if (row._id.mode === 'CHAT') bucket.chats += row.count;
      if (row._id.mode === 'AUDIO') bucket.voice += row.count;
      if (row._id.mode === 'VIDEO') bucket.video += row.count;
    }

    return buckets;
  }

  async getBusyListeners({ search, skip, limit }) {
    const matchQuery = { kycStatus: 'APPROVED', availability: 'BUSY' };

    if (search) {
      const matchedUsers = await mongoose.model('User').find({
        type: 'LISTENER',
        isDeleted: false,
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
        ],
      }).select('_id').lean();
      matchQuery.userId = { $in: matchedUsers.map((u) => u._id) };
    }

    const aggPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'communicationsessions',
          let: { uid: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$listenerId', '$$uid'] },
                    { $eq: ['$status', 'ONGOING'] },
                  ],
                },
              },
            },
            { $sort: { startTime: -1 } },
            { $limit: 1 },
          ],
          as: 'session',
        },
      },
      { $unwind: { path: '$session', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'sessionsegments',
          let: { sid: '$session._id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$sessionId', '$$sid'] } } },
            { $sort: { startTime: -1 } },
            { $limit: 1 },
          ],
          as: 'currentSegment',
        },
      },
      { $unwind: { path: '$currentSegment', preserveNullAndEmptyArrays: true } },
      userLookup('userId', 'user'),
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          listenerId: '$userId',
          listenerProfileId: '$_id',
          name: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$user.firstName', ''] },
                  ' ',
                  { $ifNull: ['$user.lastName', ''] },
                ],
              },
            },
          },
          profileImage: '$user.profileImage',
          mode: { $ifNull: ['$currentSegment.mode', 'CHAT'] },
          sessionId: '$session._id',
          sessionStart: '$session.startTime',
          durationSeconds: {
            $cond: [
              { $ifNull: ['$session.startTime', false] },
              {
                $divide: [{ $subtract: [new Date(), '$session.startTime'] }, 1000],
              },
              0,
            ],
          },
        },
      },
      { $sort: { sessionStart: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const [result] = await ListenerProfile.aggregate(aggPipeline).allowDiskUse(false);
    const total = result?.metadata?.[0]?.total ?? 0;
    const data = (result?.data ?? []).map((row) => ({
      listenerId: row.listenerId?.toString(),
      listenerProfileId: row.listenerProfileId?.toString(),
      name: row.name?.trim() || 'Listener',
      profileImage: row.profileImage ?? null,
      mode: row.mode ?? 'CHAT',
      sessionId: row.sessionId?.toString() ?? null,
      sessionStart: row.sessionStart ?? null,
      durationSeconds: Math.round(row.durationSeconds ?? 0),
    }));

    return { total, data };
  }

  async getChatSessions({ search, skip, limit }) {
    const matchQuery = { status: 'ONGOING' };

    const pipeline = [
      { $match: matchQuery },
      latestSegmentLookup(),
      { $unwind: { path: '$currentSegment', preserveNullAndEmptyArrays: false } },
      { $match: { 'currentSegment.mode': 'CHAT' } },
      userLookup('callerId', 'caller'),
      userLookup('listenerId', 'listener'),
      { $unwind: { path: '$caller', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$listener', preserveNullAndEmptyArrays: true } },
    ];

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      const orConditions = [
        { 'caller.firstName': searchRegex },
        { 'caller.lastName': searchRegex },
        { 'listener.firstName': searchRegex },
        { 'listener.lastName': searchRegex },
      ];
      if (mongoose.Types.ObjectId.isValid(search)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(search) });
      }
      pipeline.push({ $match: { $or: orConditions } });
    }

    const [result] = await CommunicationSession.aggregate([
      ...pipeline,
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $sort: { startTime: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                sessionId: '$_id',
                status: 1,
                startedAt: '$startTime',
                durationSeconds: {
                  $cond: [
                    { $ifNull: ['$startTime', false] },
                    { $divide: [{ $subtract: [new Date(), '$startTime'] }, 1000] },
                    0,
                  ],
                },
                coinsSpent: '$totalCoinsSpent',
                caller: {
                  id: '$caller._id',
                  name: {
                    $trim: {
                      input: {
                        $concat: [
                          { $ifNull: ['$caller.firstName', ''] },
                          ' ',
                          { $ifNull: ['$caller.lastName', ''] },
                        ],
                      },
                    },
                  },
                  profileImage: '$caller.profileImage',
                },
                listener: {
                  id: '$listener._id',
                  name: {
                    $trim: {
                      input: {
                        $concat: [
                          { $ifNull: ['$listener.firstName', ''] },
                          ' ',
                          { $ifNull: ['$listener.lastName', ''] },
                        ],
                      },
                    },
                  },
                  profileImage: '$listener.profileImage',
                },
              },
            },
          ],
        },
      },
    ]).allowDiskUse(false);

    const total = result?.metadata?.[0]?.total ?? 0;
    const data = (result?.data ?? []).map((row) => ({
      sessionId: row.sessionId?.toString(),
      status: row.status,
      startedAt: row.startedAt,
      durationSeconds: Math.round(row.durationSeconds ?? 0),
      coinsSpent: row.coinsSpent ?? 0,
      caller: {
        id: row.caller?.id?.toString(),
        name: row.caller?.name?.trim() || 'Unknown',
        profileImage: row.caller?.profileImage ?? null,
      },
      listener: {
        id: row.listener?.id?.toString(),
        name: row.listener?.name?.trim() || 'Unknown',
        profileImage: row.listener?.profileImage ?? null,
      },
    }));

    return { total, data };
  }
}

export default new AdminDashboardRepository();
