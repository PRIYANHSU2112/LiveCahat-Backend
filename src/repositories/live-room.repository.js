import BaseRepository from './base.repository.js';
import LiveRoom from '../modules/live-room.model.js';

class LiveRoomRepository extends BaseRepository {
  constructor() {
    super(LiveRoom);
  }

  async findLiveRooms(skip = 0, limit = 20) {
    return this.findMany({ status: 'live' }, '', '', { startedAt: -1 }, limit, skip);
  }

  async findActiveByHostId(hostId) {
    return this.findOne({ hostId, status: 'live' });
  }
}

export default new LiveRoomRepository();
