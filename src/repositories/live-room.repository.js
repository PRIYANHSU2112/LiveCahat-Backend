import BaseRepository from './base.repository.js';
import LiveRoom from '../modules/live-room.model.js';

class LiveRoomRepository extends BaseRepository {
  constructor() {
    super(LiveRoom);
  }

  async findLiveRooms(skip = 0, limit = 20) {
    return this.findMany(
      { status: 'live' },
      '',
      { path: 'hostId', select: 'firstName lastName profileImage' },
      { startedAt: -1 },
      limit,
      skip,
    );
  }

  async findActiveByHostId(hostId) {
    return this.findOne({ hostId, status: 'live' });
  }

  /**
   * Batch mark orphaned or rebooted live rooms as ended in MongoDB.
   */
  async cleanupOrphanedRooms(filter = {}, endReason = 'SERVER_REBOOT') {
    return this.model.updateMany(
      { status: 'live', ...filter },
      {
        $set: {
          status: 'ended',
          endedAt: new Date(),
          endReason,
        },
      }
    );
  }
}

export default new LiveRoomRepository();
