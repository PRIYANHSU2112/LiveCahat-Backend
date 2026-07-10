import mongoose from 'mongoose';
import CommunicationSession from '../modules/communication-session.model.js';
import SessionSegment from '../modules/session-segment.model.js';

const ENDED_STATUSES = ['COMPLETED', 'MISSED', 'REJECTED', 'FAILED'];
const FAILED_STATUSES = ['MISSED', 'REJECTED', 'FAILED'];

const userLookup = (localField, as) => ({
  $lookup: {
    from: 'users',
    localField,
    foreignField: '_id',
    as,
    pipeline: [{ $project: { firstName: 1, lastName: 1, profileImage: 1, type: 1 } }],
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

const formatUserName = (user) => {
  if (!user) return 'Unknown';
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || 'Unknown';
};

class AdminCommunicationRepository {
  async getSessionStats({ start, end, mode = 'all' }) {
    const periodMatch = { createdAt: { $gte: start, $lte: end } };
    const activeMatch = { status: 'ONGOING' };

    const [activeCount, periodFacet] = await Promise.all([
      CommunicationSession.countDocuments(activeMatch),
      CommunicationSession.aggregate([
        { $match: periodMatch },
        {
          $facet: {
            completed: [
              { $match: { status: 'COMPLETED' } },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  avgDuration: { $avg: '$duration' },
                },
              },
            ],
            failed: [
              { $match: { status: { $in: FAILED_STATUSES } } },
              { $count: 'n' },
            ],
            ended: [
              { $match: { status: { $in: ENDED_STATUSES } } },
              { $count: 'n' },
            ],
          },
        },
      ]).allowDiskUse(false),
    ]);

    const facet = periodFacet[0] ?? {};
    const completedRow = facet.completed?.[0] ?? {};
    const completedCount = completedRow.count ?? 0;
    const failedCount = facet.failed?.[0]?.n ?? 0;
    const endedTotal = facet.ended?.[0]?.n ?? 0;
    const dropRatePct =
      endedTotal > 0 ? Math.round((failedCount / endedTotal) * 1000) / 10 : 0;

    let byMode = { chat: 0, audio: 0, video: 0 };
    if (mode === 'all') {
      const modeRows = await SessionSegment.aggregate([
        { $match: { status: 'ONGOING' } },
        { $group: { _id: '$mode', count: { $sum: 1 } } },
      ]).allowDiskUse(false);
      for (const row of modeRows) {
        if (row._id === 'CHAT') byMode.chat = row.count;
        if (row._id === 'AUDIO') byMode.audio = row.count;
        if (row._id === 'VIDEO') byMode.video = row.count;
      }
    }

    return {
      activeCount,
      completedCount,
      failedCount,
      avgDurationSeconds: completedRow.avgDuration ?? 0,
      dropRatePct,
      byMode,
    };
  }

  _buildSessionListPipeline({ matchQuery, mode, search, sort, skip, limit, includePagination = true }) {
    const pipeline = [
      { $match: matchQuery },
      latestSegmentLookup(),
      { $unwind: { path: '$currentSegment', preserveNullAndEmptyArrays: true } },
    ];

    if (mode && mode !== 'all') {
      pipeline.push({ $match: { 'currentSegment.mode': mode } });
    }

    pipeline.push(
      userLookup('callerId', 'caller'),
      userLookup('listenerId', 'listener'),
      { $unwind: { path: '$caller', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$listener', preserveNullAndEmptyArrays: true } }
    );

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

    const dataPipeline = [
      { $sort: sort },
      ...(includePagination ? [{ $skip: skip }, { $limit: limit }] : []),
      {
        $project: {
          _id: 1,
          status: 1,
          startTime: 1,
          endTime: 1,
          duration: 1,
          totalCoinsSpent: 1,
          totalCoinsEarned: 1,
          disconnectReason: 1,
          createdAt: 1,
          mode: { $ifNull: ['$currentSegment.mode', 'CHAT'] },
          caller: {
            _id: '$caller._id',
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
            _id: '$listener._id',
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
    ];

    return { pipeline, dataPipeline };
  }

  async getPaginatedSessions({ matchQuery, mode, search, sort, skip, limit }) {
    const { pipeline, dataPipeline } = this._buildSessionListPipeline({
      matchQuery,
      mode,
      search,
      sort,
      skip,
      limit,
      includePagination: true,
    });

    const [result] = await CommunicationSession.aggregate([
      ...pipeline,
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: dataPipeline,
        },
      },
    ]).allowDiskUse(false);

    const total = result?.metadata?.[0]?.total ?? 0;
    const data = (result?.data ?? []).map((row) => ({
      ...row,
      caller: { ...row.caller, name: row.caller?.name?.trim() || 'Unknown' },
      listener: { ...row.listener, name: row.listener?.name?.trim() || 'Unknown' },
    }));

    return { total, data };
  }

  async getLiveSessions({ mode = 'all', limit = 50 }) {
    const { pipeline, dataPipeline } = this._buildSessionListPipeline({
      matchQuery: { status: 'ONGOING' },
      mode,
      search: null,
      sort: { startTime: -1 },
      skip: 0,
      limit,
      includePagination: true,
    });

    const rows = await CommunicationSession.aggregate([...pipeline, ...dataPipeline]).allowDiskUse(false);
    return rows.map((row) => ({
      ...row,
      caller: { ...row.caller, name: row.caller?.name?.trim() || 'Unknown' },
      listener: { ...row.listener, name: row.listener?.name?.trim() || 'Unknown' },
    }));
  }

  async getSessionDetail(sessionId) {
    const session = await CommunicationSession.findById(sessionId)
      .populate('callerId', 'firstName lastName profileImage type')
      .populate('listenerId', 'firstName lastName profileImage type')
      .lean();

    if (!session) return null;

    const segments = await SessionSegment.find({ sessionId })
      .sort({ startTime: 1 })
      .lean();

    const toUser = (user) => ({
      _id: user?._id,
      name: user ? formatUserName(user) : 'Unknown',
      profileImage: user?.profileImage ?? null,
      type: user?.type,
    });

    return {
      _id: session._id,
      status: session.status,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      totalCoinsSpent: session.totalCoinsSpent,
      totalCoinsEarned: session.totalCoinsEarned,
      disconnectReason: session.disconnectReason,
      rating: session.rating,
      reviewComment: session.reviewComment,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      caller: toUser(session.callerId),
      listener: toUser(session.listenerId),
      segments,
      currentMode: segments.length ? segments[segments.length - 1].mode : 'CHAT',
    };
  }
}

export default new AdminCommunicationRepository();
