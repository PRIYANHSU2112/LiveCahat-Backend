import BaseRepository from './base.repository.js';
import LiveComment from '../modules/live-comment.model.js';

class LiveCommentRepository extends BaseRepository {
  constructor() {
    super(LiveComment);
  }

  async findByRoomId(roomId, limit = 50, skip = 0) {
    return this.findMany(
      { roomId },
      '',
      '',
      { createdAt: -1 },
      limit,
      skip
    );
  }

  async bulkInsert(comments) {
    if (!comments || !comments.length) return [];
    return LiveComment.insertMany(comments, { ordered: false });
  }
}

export default new LiveCommentRepository();
