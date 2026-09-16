import BaseService from './base.service.js';
import storyRepository from '../repositories/story.repository.js';
import storyViewRepository from '../repositories/story-view.repository.js';
import storyUploadService from './story-upload.service.js';
import followRepository from '../repositories/follow.repository.js';
import ChatMessage from '../modules/chat-message.model.js';
import User from '../modules/user.model.js';
import LiveRoom from '../modules/live-room.model.js';
import redisClient from '../config/redis.js';
import { KEYS } from '../utils/socket-redis-keys.util.js';
import { getSocketIo } from '../utils/socket.util.js';
import { SERVER_EVENTS } from '../constants/socket-event.constant.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.util.js';
import mongoose from 'mongoose';

const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ROLLING_VIEW_TTL_SEC = 86400; // 24 hours

class StoryService extends BaseService {
  constructor() {
    super(storyRepository);
  }

  // ─── CREATE STORY ─────────────────────────────────────────────────────────

  /**
   * Create a new story (IMAGE, VIDEO, or TEXT).
   * Validates media via HeadObject verification for uploaded files.
   */
  async createStory(userId, data) {
    const {
      type = 'IMAGE',
      fileKey,
      uploadToken,
      thumbnailUrl,
      caption = '',
      text = '',
      metadata = {},
      visibility = 'PUBLIC',
    } = data;

    let mediaUrl = null;
    let verifiedFileKey = null;

    if (type === 'IMAGE' || type === 'VIDEO') {
      if (data.mediaUrl) {
        mediaUrl = data.mediaUrl;
        verifiedFileKey = fileKey || `stories/${userId}/${Date.now()}`;
      } else if (fileKey) {
        // Authoritative verification against S3 / Spaces
        const verified = await storyUploadService.verifyUploadedMedia(userId, fileKey, uploadToken);
        mediaUrl = verified.mediaUrl;
        verifiedFileKey = verified.fileKey;
      } else {
        throw new ApiError(400, 'Media file or fileKey is required for IMAGE or VIDEO stories');
      }
    } else if (type === 'TEXT') {
      if (!text || !text.trim()) {
        throw new ApiError(400, 'text content is required for TEXT stories');
      }
    } else {
      throw new ApiError(400, `Unsupported story type for direct creation: ${type}`);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + STORY_TTL_MS);

    // Build strict metadata object
    const cleanMetadata = {
      width: metadata.width ? Math.min(Math.max(Number(metadata.width), 0), 4096) : null,
      height: metadata.height ? Math.min(Math.max(Number(metadata.height), 0), 4096) : null,
      duration: metadata.duration ? Math.min(Math.max(Number(metadata.duration), 0), 300) : 0,
      backgroundColor: metadata.backgroundColor ? String(metadata.backgroundColor).slice(0, 30) : null,
      textColor: metadata.textColor ? String(metadata.textColor).slice(0, 30) : null,
      fontFamily: metadata.fontFamily ? String(metadata.fontFamily).slice(0, 50) : null,
    };

    const story = await this.repository.create({
      ownerId: userId,
      type,
      status: 'ACTIVE',
      fileKey: verifiedFileKey,
      mediaUrl,
      thumbnailUrl: thumbnailUrl || (type === 'IMAGE' ? mediaUrl : null),
      caption: caption ? caption.slice(0, 500) : '',
      text: text ? text.slice(0, 1000) : '',
      metadata: cleanMetadata,
      visibility,
      expiresAt,
    });

    // Update Redis ZSET stories:active_owners with score = timestamp (epoch ms)
    if (redisClient.isRedisAvailable) {
      try {
        await redisClient.zadd(KEYS.storiesActiveOwners(), now.getTime(), userId.toString());
      } catch (err) {
        logger.error(`[StoryService] Failed to update active_owners ZSET: ${err.message}`);
      }
    }

    logger.info(`[StoryService] Created story ${story._id} (${type}) for owner ${userId}`);
    return story;
  }

  // ─── STORY FEED & 6-TIER RANKING ──────────────────────────────────────────

  /**
   * Get ranked story bubbles feed with cursor-based pagination.
   *
   * 6-Tier Ranking Hierarchy:
   *  1. Following + Live + Unseen  (Priority Score 60)
   *  2. Following + Unseen         (Priority Score 50)
   *  3. Following + Seen           (Priority Score 40)
   *  4. Other Live + Unseen        (Priority Score 30)
   *  5. Other + Unseen             (Priority Score 20)
   *  6. Other + Seen               (Priority Score 10)
   *
   * Tie-breaker: latestStoryAt desc, then ownerId desc.
   */
  async getStoryFeed(viewerId, { cursor = null, limit = 20 } = {}) {
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const now = new Date();
    const nowMs = now.getTime();
    const activeThresholdMs = nowMs - STORY_TTL_MS;

    // ─── Step 1: Resolve Candidate Owners (Following, Live, Active ZSET) ───
    const [followingSet, activeLiveSet, activeZsetOwners] = await Promise.all([
      this._getViewerFollowingSet(viewerId),
      this._getActiveLiveHosts(),
      this._getActiveOwnersFromZset(activeThresholdMs),
    ]);

    // Merge candidate owner IDs
    const candidateOwnerIdsSet = new Set([
      ...followingSet,
      ...activeLiveSet,
      ...activeZsetOwners,
    ]);

    // If Redis ZSET was empty or unavailable, fallback to Mongo active owner search
    if (activeZsetOwners.length === 0) {
      const activeOwnersFromMongo = await this.repository.model.distinct('ownerId', {
        status: 'ACTIVE',
        $or: [{ type: 'LIVE' }, { expiresAt: { $gt: now } }],
      });
      activeOwnersFromMongo.forEach((id) => candidateOwnerIdsSet.add(id.toString()));
    }

    // Filter out viewer's own stories from the feed (own stories shown in /stories/me)
    candidateOwnerIdsSet.delete(viewerId.toString());

    if (candidateOwnerIdsSet.size === 0) {
      return {
        items: [],
        pagination: { nextCursor: null, hasNextPage: false, limit: parsedLimit },
      };
    }

    const candidateOwnerIds = Array.from(candidateOwnerIdsSet);

    // ─── Step 2: Fetch Active Stories using Compound Index ─────────────────
    const activeStories = await this.repository.findActiveStoriesByOwners(candidateOwnerIds, now);

    if (!activeStories || activeStories.length === 0) {
      return {
        items: [],
        pagination: { nextCursor: null, hasNextPage: false, limit: parsedLimit },
      };
    }

    // ─── Step 3: Resolve Seen State from Expiring Redis Set ────────────────
    const allStoryIds = activeStories.map((s) => s._id.toString());
    const viewedStoryIdsSet = await this._getViewedStoryIds(viewerId, allStoryIds);

    // ─── Step 4: Group Stories into Bubbles per Owner ─────────────────────
    const bubblesByOwner = new Map();

    for (const story of activeStories) {
      const owner = story.ownerId;
      if (!owner || !owner._id) continue;

      const ownerIdStr = owner._id.toString();

      if (!bubblesByOwner.has(ownerIdStr)) {
        bubblesByOwner.set(ownerIdStr, {
          ownerId: ownerIdStr,
          owner: {
            _id: owner._id,
            firstName: owner.firstName || '',
            lastName: owner.lastName || '',
            profileImage: owner.profileImage || null,
            type: owner.type || 'CUSTOMER',
            isOnline: !!owner.isOnline,
          },
          storiesCount: 0,
          hasUnseen: false,
          isLive: false,
          liveSessionId: null,
          latestStoryAt: story.createdAt,
          storyIds: [],
        });
      }

      const bubble = bubblesByOwner.get(ownerIdStr);
      bubble.storiesCount += 1;
      bubble.storyIds.push(story._id.toString());

      if (new Date(story.createdAt) > new Date(bubble.latestStoryAt)) {
        bubble.latestStoryAt = story.createdAt;
      }

      if (story.type === 'LIVE') {
        bubble.isLive = true;
        const rawSessionId = story.liveSessionId?._id || story.liveSessionId;
        bubble.liveSessionId = rawSessionId ? rawSessionId.toString() : null;
      }

      // Check if this story is unseen
      if (!viewedStoryIdsSet.has(story._id.toString())) {
        bubble.hasUnseen = true;
      }
    }

    // Also check if any candidate in activeLiveSet didn't have a story document yet
    for (const liveHostId of activeLiveSet) {
      if (liveHostId === viewerId.toString()) continue;
      if (bubblesByOwner.has(liveHostId)) {
        const bubble = bubblesByOwner.get(liveHostId);
        bubble.isLive = true;
      }
    }

    // ─── Step 5: Assign 6-Tier Priority Buckets ───────────────────────────
    const rankedBubbles = Array.from(bubblesByOwner.values()).map((bubble) => {
      const isFollowing = followingSet.has(bubble.ownerId);
      const isLive = bubble.isLive;
      const hasUnseen = bubble.hasUnseen;

      let priorityScore = 10; // Default: Other + Seen
      if (isFollowing && isLive && hasUnseen) priorityScore = 60;
      else if (isFollowing && !isLive && hasUnseen) priorityScore = 50;
      else if (isFollowing && !hasUnseen) priorityScore = 40;
      else if (!isFollowing && isLive && hasUnseen) priorityScore = 30;
      else if (!isFollowing && !isLive && hasUnseen) priorityScore = 20;

      const latestTimeMs = new Date(bubble.latestStoryAt).getTime();

      return {
        ...bubble,
        isFollowing,
        priorityScore,
        latestTimeMs,
      };
    });

    // Sort: Priority desc, latestTimeMs desc, ownerId desc
    rankedBubbles.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      if (b.latestTimeMs !== a.latestTimeMs) {
        return b.latestTimeMs - a.latestTimeMs;
      }
      return b.ownerId.localeCompare(a.ownerId);
    });

    // ─── Step 6: Apply Opaque Cursor Pagination ───────────────────────────
    let startIndex = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        const { score, ts, id } = decoded;

        const foundIndex = rankedBubbles.findIndex((b) => {
          if (b.priorityScore < score) return true;
          if (b.priorityScore === score && b.latestTimeMs < ts) return true;
          if (b.priorityScore === score && b.latestTimeMs === ts && b.ownerId.localeCompare(id) < 0) {
            return true;
          }
          return false;
        });

        if (foundIndex !== -1) {
          startIndex = foundIndex;
        } else {
          startIndex = rankedBubbles.length;
        }
      } catch (err) {
        logger.warn(`[StoryService] Malformed cursor: ${cursor}`);
        startIndex = 0;
      }
    }

    const pageItems = rankedBubbles.slice(startIndex, startIndex + parsedLimit);
    const hasNextPage = startIndex + parsedLimit < rankedBubbles.length;

    let nextCursor = null;
    if (hasNextPage && pageItems.length > 0) {
      const lastItem = pageItems[pageItems.length - 1];
      const cursorPayload = {
        score: lastItem.priorityScore,
        ts: lastItem.latestTimeMs,
        id: lastItem.ownerId,
      };
      nextCursor = Buffer.from(JSON.stringify(cursorPayload)).toString('base64');
    }

    // Clean response objects (omit internal sort metrics and raw story ID arrays)
    const sanitizedItems = pageItems.map((item) => ({
      ownerId: item.ownerId,
      owner: item.owner,
      storiesCount: item.storiesCount,
      hasUnseen: item.hasUnseen,
      isLive: item.isLive,
      liveSessionId: item.liveSessionId,
      latestStoryAt: item.latestStoryAt,
      isFollowing: item.isFollowing,
    }));

    return {
      items: sanitizedItems,
      pagination: {
        nextCursor,
        hasNextPage,
        limit: parsedLimit,
      },
    };
  }

  // ─── GET OWNER'S STORIES (Playback) ──────────────────────────────────────

  /**
   * Get all active stories for a specific owner in playback order.
   * Attaches hasViewed status for the requesting viewer.
   */
  async getOwnerStories(ownerId, viewerId) {
    const now = new Date();
    const stories = await this.repository.findActiveStoriesByOwner(ownerId, now);

    if (!stories || stories.length === 0) {
      return { owner: null, stories: [] };
    }

    const owner = stories[0].ownerId;
    const storyIds = stories.map((s) => s._id.toString());
    const viewedSet = await this._getViewedStoryIds(viewerId, storyIds);

    const formattedStories = stories.map((story) => ({
      _id: story._id,
      type: story.type,
      mediaUrl: story.mediaUrl,
      thumbnailUrl: story.thumbnailUrl,
      caption: story.caption,
      text: story.text,
      metadata: story.metadata,
      duration: story.duration,
      liveSessionId: story.liveSessionId,
      viewsCount: story.viewsCount,
      createdAt: story.createdAt,
      expiresAt: story.expiresAt,
      hasViewed: viewedSet.has(story._id.toString()),
    }));

    return {
      owner,
      stories: formattedStories,
    };
  }

  // ─── GET MY STORIES (Owner View) ──────────────────────────────────────────

  /**
   * Get logged-in user's own active stories with view statistics.
   */
  async getMyStories(userId) {
    const now = new Date();
    const stories = await this.repository.findActiveStoriesByOwner(userId, now);

    return {
      count: stories.length,
      stories: stories.map((story) => ({
        _id: story._id,
        type: story.type,
        mediaUrl: story.mediaUrl,
        thumbnailUrl: story.thumbnailUrl,
        caption: story.caption,
        text: story.text,
        metadata: story.metadata,
        viewsCount: story.viewsCount,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt,
      })),
    };
  }

  // ─── BATCH RECORD VIEWS ───────────────────────────────────────────────────

  /**
   * High-throughput batch story view tracking.
   * Atomically records views in MongoDB and updates the expiring Redis view cache.
   */
  async batchRecordViews(viewerId, storyIds) {
    if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
      return { success: true, count: 0 };
    }

    // Deduplicate incoming storyIds
    const uniqueIds = [...new Set(storyIds.map((id) => String(id).trim()))];
    const objectIds = uniqueIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (objectIds.length === 0) {
      return { success: true, count: 0 };
    }

    // Fetch story owners to construct view entries
    const stories = await this.repository.model
      .find({ _id: { $in: objectIds } })
      .select('_id ownerId')
      .lean();

    if (stories.length === 0) {
      return { success: true, count: 0 };
    }

    const viewEntries = stories.map((s) => ({
      storyId: s._id,
      storyOwnerId: s.ownerId,
    }));

    // Non-blocking bulk upsert to StoryView
    const result = await storyViewRepository.batchRecordViews(viewerId, viewEntries);

    // Atomically increment viewsCount on newly viewed stories (parallel)
    if (result.upsertedStoryIds && result.upsertedStoryIds.length > 0) {
      await Promise.allSettled(
        result.upsertedStoryIds.map((storyId) => this.repository.incrementViewCount(storyId))
      );
    }

    // Add to viewer's expiring Redis set with 24h rolling TTL
    if (redisClient.isRedisAvailable) {
      try {
        const viewKey = KEYS.userStoryViews(viewerId);
        const pipeline = redisClient.pipeline();
        pipeline.sadd(viewKey, ...uniqueIds);
        pipeline.expire(viewKey, ROLLING_VIEW_TTL_SEC);
        await pipeline.exec();
      } catch (err) {
        logger.error(`[StoryService] Failed to update Redis user views: ${err.message}`);
      }
    }

    return {
      success: true,
      count: result.upsertedCount,
    };
  }

  // ─── STORY REPLY INTEGRATION (Via Chat Message) ──────────────────────────

  /**
   * Reply to a story.
   * Reuses the existing conversation/message architecture without creating duplicate models.
   */
  async replyToStory(senderId, storyId, text) {
    if (!text || !text.trim()) {
      throw new ApiError(400, 'Reply text is required');
    }

    const story = await this.repository.findActiveById(storyId);
    if (!story) {
      throw new ApiError(404, 'Story not found or has expired');
    }

    const owner = story.ownerId;
    const recipientId = (owner?._id || owner).toString();
    const senderIdStr = senderId.toString();

    if (recipientId === senderIdStr) {
      throw new ApiError(400, 'You cannot reply to your own story');
    }

    // Construct lean storyContext
    const storyContext = {
      storyId: story._id,
      type: story.type,
      thumbnailUrl: story.thumbnailUrl || story.mediaUrl || null,
    };

    // Create ChatMessage with lean storyContext
    const message = await ChatMessage.create({
      senderId,
      recipientId,
      text: text.trim(),
      messageType: 'TEXT',
      storyContext,
      deliveryStatus: 'SENT',
    });

    // Populate sender info for real-time socket delivery
    const populatedMsg = await ChatMessage.findById(message._id)
      .populate('senderId', 'firstName lastName profileImage')
      .lean();

    // Dispatch via Socket.IO to recipient if online
    const io = getSocketIo();
    if (io) {
      const serverTimestamp = new Date().toISOString();
      const messagePayload = {
        clientMsgId: `story_reply_${message._id}`,
        senderId: senderIdStr,
        recipientId,
        text: message.text,
        messageType: 'TEXT',
        storyContext,
        serverTimestamp,
        createdAt: message.createdAt,
      };

      io.to(recipientId).emit(SERVER_EVENTS.CHAT_RECEIVE_MESSAGE, messagePayload);
      logger.info(`[StoryReply] Dispatched story reply from ${senderIdStr} -> ${recipientId}`);
    }

    return message;
  }

  // ─── DELETE STORY ─────────────────────────────────────────────────────────

  /**
   * Delete a story (soft delete: status = 'DELETED').
   * Reconciles the active_owners ZSET.
   */
  async deleteStory(storyId, userId) {
    const story = await this.repository.findById(storyId);
    if (!story) {
      throw new ApiError(404, 'Story not found');
    }

    const ownerIdStr = (story.ownerId._id || story.ownerId).toString();
    if (ownerIdStr !== userId.toString()) {
      throw new ApiError(403, 'You are not authorized to delete this story');
    }

    await this.repository.updateById(storyId, { status: 'DELETED' });

    // Check if owner has any remaining active stories
    const remainingCount = await this.repository.countActiveStoriesForOwner(userId);
    if (remainingCount === 0 && redisClient.isRedisAvailable) {
      try {
        await redisClient.zrem(KEYS.storiesActiveOwners(), userId.toString());
      } catch (err) {
        logger.error(`[StoryService] Failed to zrem active owner: ${err.message}`);
      }
    }

    logger.info(`[StoryService] Story ${storyId} deleted by owner ${userId}`);
    return { success: true };
  }

  // ─── LIVE STORY SYNCHRONIZATION ───────────────────────────────────────────

  /**
   * Sync active LIVE story when host starts live room.
   */
  async syncLiveStoryStarted(hostId, liveRoom) {
    try {
      const hostIdStr = hostId.toString();
      const roomIdStr = (liveRoom._id || liveRoom).toString();

      // Upsert LIVE story document
      await this.repository.model.findOneAndUpdate(
        { liveSessionId: roomIdStr },
        {
          $setOnInsert: {
            ownerId: hostId,
            type: 'LIVE',
            liveSessionId: roomIdStr,
            status: 'ACTIVE',
            caption: liveRoom.title || '',
            expiresAt: null, // stays active until live ends
          },
        },
        { upsert: true, new: true }
      );

      // Update Redis presence
      if (redisClient.isRedisAvailable) {
        const pipeline = redisClient.pipeline();
        pipeline.zadd(KEYS.storiesActiveOwners(), Date.now(), hostIdStr);
        pipeline.sadd(KEYS.storiesActiveLive(), hostIdStr);
        await pipeline.exec();
      }

      // Targeted socket dispatch: followers + story:owner room (No global io.emit flood)
      const io = getSocketIo();
      if (io) {
        const payload = {
          liveSessionId: roomIdStr,
          hostId: hostIdStr,
          title: liveRoom.title || '',
          mode: liveRoom.mode || 'VIDEO',
        };

        // Emit to targeted room for users viewing this host
        io.to(`story:owner:${hostIdStr}`).emit(SERVER_EVENTS.STORY_LIVE_STARTED, payload);

        // Emit directly to host's followers
        const followers = await followRepository.model
          .find({ followingId: hostId })
          .select('followerId')
          .lean();

        followers.forEach((f) => {
          if (f.followerId) {
            io.to(f.followerId.toString()).emit(SERVER_EVENTS.STORY_LIVE_STARTED, payload);
          }
        });
      }

      logger.info(`[StoryService] Synced LIVE story for host ${hostIdStr}, room ${roomIdStr}`);
    } catch (err) {
      logger.error(`[StoryService] syncLiveStoryStarted error: ${err.message}`);
    }
  }

  /**
   * Mark LIVE story as ENDED when live room ends.
   */
  async syncLiveStoryEnded(liveRoomId, hostId) {
    try {
      const roomIdStr = (liveRoomId._id || liveRoomId).toString();
      await this.repository.markLiveStoryEnded(roomIdStr);

      const hostIdStr = hostId ? hostId.toString() : null;

      if (redisClient.isRedisAvailable && hostIdStr) {
        await redisClient.srem(KEYS.storiesActiveLive(), hostIdStr);

        // If host has no other active stories, remove from active_owners ZSET
        const count = await this.repository.countActiveStoriesForOwner(hostId);
        if (count === 0) {
          await redisClient.zrem(KEYS.storiesActiveOwners(), hostIdStr);
        }
      }

      // Targeted socket dispatch: followers + story:owner room
      const io = getSocketIo();
      if (io && hostIdStr) {
        const payload = {
          liveSessionId: roomIdStr,
          hostId: hostIdStr,
        };

        io.to(`story:owner:${hostIdStr}`).emit(SERVER_EVENTS.STORY_LIVE_ENDED, payload);

        const followers = await followRepository.model
          .find({ followingId: hostId })
          .select('followerId')
          .lean();

        followers.forEach((f) => {
          if (f.followerId) {
            io.to(f.followerId.toString()).emit(SERVER_EVENTS.STORY_LIVE_ENDED, payload);
          }
        });
      }

      logger.info(`[StoryService] Marked LIVE story ended for room ${roomIdStr}`);
    } catch (err) {
      logger.error(`[StoryService] syncLiveStoryEnded error: ${err.message}`);
    }
  }

  // ─── ASYNC CLEANUP (BullMQ Worker Hook) ───────────────────────────────────

  /**
   * Background expiry cleanup of non-live stories.
   */
  async cleanupExpiredStories() {
    const now = new Date();
    const result = await this.repository.markExpired(now);

    // Prune owners from Redis ZSET who no longer have active stories
    if (redisClient.isRedisAvailable) {
      try {
        const activeThresholdMs = now.getTime() - STORY_TTL_MS;
        // Owners with scores older than activeThresholdMs
        const expiredOwnerIds = await redisClient.zrangebyscore(
          KEYS.storiesActiveOwners(),
          '-inf',
          activeThresholdMs
        );

        if (expiredOwnerIds.length > 0) {
          for (const ownerId of expiredOwnerIds) {
            const count = await this.repository.countActiveStoriesForOwner(ownerId, now);
            if (count === 0) {
              await redisClient.zrem(KEYS.storiesActiveOwners(), ownerId);
            }
          }
        }
      } catch (err) {
        logger.error(`[StoryService] Redis ZSET prune error: ${err.message}`);
      }
    }

    logger.info(`[StoryService] Expired ${result.modifiedCount} stories at ${now.toISOString()}`);
    return result.modifiedCount;
  }

  // ─── PRIVATE CACHE HELPERS ────────────────────────────────────────────────

  async _getViewerFollowingSet(viewerId) {
    if (redisClient.isRedisAvailable) {
      try {
        const cacheKey = KEYS.userFollowingSet(viewerId);
        const cached = await redisClient.smembers(cacheKey);
        if (cached && cached.length > 0) {
          return new Set(cached);
        }
      } catch (err) {
        logger.error(`[StoryService] Error reading following cache: ${err.message}`);
      }
    }

    // Fallback: Query Follow collection
    const follows = await followRepository.model
      .find({ followerId: viewerId })
      .select('followingId')
      .lean();

    const followingIds = follows.map((f) => f.followingId.toString());

    if (redisClient.isRedisAvailable && followingIds.length > 0) {
      try {
        const cacheKey = KEYS.userFollowingSet(viewerId);
        await redisClient.sadd(cacheKey, ...followingIds);
        await redisClient.expire(cacheKey, 3600); // 1h TTL
      } catch (err) {
        // ignore cache write error
      }
    }

    return new Set(followingIds);
  }

  async _getActiveLiveHosts() {
    if (redisClient.isRedisAvailable) {
      try {
        const hosts = await redisClient.smembers(KEYS.storiesActiveLive());
        if (hosts) return new Set(hosts);
      } catch (err) {
        logger.error(`[StoryService] Error reading active live hosts: ${err.message}`);
      }
    }

    // Fallback: query active live rooms
    const liveRooms = await LiveRoom.find({ status: 'live' }).select('hostId').lean();
    return new Set(liveRooms.map((r) => r.hostId.toString()));
  }

  async _getActiveOwnersFromZset(activeThresholdMs) {
    if (redisClient.isRedisAvailable) {
      try {
        const owners = await redisClient.zrevrangebyscore(
          KEYS.storiesActiveOwners(),
          '+inf',
          activeThresholdMs
        );
        if (owners) return owners;
      } catch (err) {
        logger.error(`[StoryService] Error reading active_owners ZSET: ${err.message}`);
      }
    }
    return [];
  }

  async _getViewedStoryIds(viewerId, storyIds) {
    if (!storyIds || storyIds.length === 0) return new Set();

    if (redisClient.isRedisAvailable) {
      try {
        const viewedSet = await redisClient.smembers(KEYS.userStoryViews(viewerId));
        if (viewedSet && viewedSet.length > 0) {
          return new Set(viewedSet);
        }
      } catch (err) {
        logger.error(`[StoryService] Error reading viewed stories from Redis: ${err.message}`);
      }
    }

    // Fallback: Query StoryView collection
    const viewedIds = await storyViewRepository.getViewedStoryIdsForViewer(viewerId, storyIds);
    return new Set(viewedIds);
  }
}

export default new StoryService();
