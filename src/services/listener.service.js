import BaseService from './base.service.js';
import listenerRepository from '../repositories/listener.repository.js';
import userRepository from '../repositories/user.repository.js';
import ApiError from '../utils/ApiError.js';
import { deleteFromS3 } from '../utils/aws.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../utils/pagination.util.js';
import { getCache, setCache, deleteCache, bumpCacheVersion, getCacheVersion } from '../utils/redis.util.js';

class ListenerService extends BaseService {
  constructor() {
    super(listenerRepository);
  }

  async getProfile(userId) {
    const cacheKey = `listener:${userId}`;
    const cachedProfile = await getCache(cacheKey);
    if (cachedProfile) return cachedProfile;

    const profile = await this.repository.findByUserId(userId);
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    await setCache(cacheKey, profile, 300); // 5 mins cache
    return profile;
  }

  async createOrUpdateProfile(userId, data) {
    let profile = await this.repository.findOne({ userId });
    let userCacheDelete;
    if (profile) {
      profile = await this.repository.updateById(profile._id, data);
    } else {
      profile = await this.repository.create({ ...data, userId });
      // Update user type to LISTENER if it was CUSTOMER
      await userRepository.updateById(userId, { type: 'LISTENER' });
      userCacheDelete = deleteCache(`user:${userId}`); // invalidate user cache too
    }
    
    const tasks = [
      deleteCache(`listener:${userId}`),
      bumpCacheVersion('listeners')
    ];
    if (userCacheDelete) tasks.push(userCacheDelete);

    await Promise.all(tasks);
    return profile;
  }

  async submitKyc(userId, kycData) {
    const profile = await this.repository.findOne({ userId }, '', '', false);
    if (!profile) throw new ApiError(404, 'Please create a listener profile first');

    const s3Tasks = [];
    if (profile.documentFront && kycData.documentFront) s3Tasks.push(deleteFromS3(profile.documentFront));
    if (profile.documentBack && kycData.documentBack) s3Tasks.push(deleteFromS3(profile.documentBack));
    if (profile.selfieImage && kycData.selfieImage) s3Tasks.push(deleteFromS3(profile.selfieImage));

    if (s3Tasks.length > 0) {
      await Promise.all(s3Tasks);
    }

    profile.documentFront = kycData.documentFront || profile.documentFront;
    profile.documentBack = kycData.documentBack || profile.documentBack;
    profile.selfieImage = kycData.selfieImage || profile.selfieImage;
    profile.kycStatus = 'UNDER_REVIEW';

    await profile.save();

    await Promise.all([
      deleteCache(`listener:${userId}`),
      bumpCacheVersion('listeners')
    ]);

    return profile;
  }

  async deleteProfile(userId) {
    const profile = await this.repository.findOne({ userId });
    if (!profile) throw new ApiError(404, 'Listener profile not found');
    
    const tasks = [
      this.repository.deleteById(profile._id),
      deleteCache(`listener:${userId}`),
      bumpCacheVersion('listeners')
    ];

    if (profile.documentFront) tasks.push(deleteFromS3(profile.documentFront));
    if (profile.documentBack) tasks.push(deleteFromS3(profile.documentBack));
    if (profile.selfieImage) tasks.push(deleteFromS3(profile.selfieImage));

    await Promise.all(tasks);

    return true;
  }

  async getAllListeners(queryParams) {
    const version = await getCacheVersion('listeners');
    const cacheKey = `listeners:list:v${version}:${JSON.stringify(queryParams)}`;
    
    const cachedData = await getCache(cacheKey);
    if (cachedData) return cachedData;

    const { page, limit, skip, sort } = getPaginationOptions(queryParams);
    
    const matchQuery = {};
    if (queryParams.kycStatus) matchQuery.kycStatus = queryParams.kycStatus;
    if (queryParams.availability) matchQuery.availability = queryParams.availability;

    const { total, data } = await this.repository.getPaginatedListeners(matchQuery, sort, skip, limit);
    const response = formatPaginatedResponse(data, total, page, limit);

    await setCache(cacheKey, response, 300); // 5 mins cache
    return response;
  }

  async approveOrRejectListener(listenerId, data) {
    const { kycStatus, rejectionReason } = data;
    
    const profile = await this.repository.findById(listenerId, '', '', false);
    if (!profile) throw new ApiError(404, 'Listener profile not found');

    profile.kycStatus = kycStatus;
    profile.rejectionReason = kycStatus === 'REJECTED' ? rejectionReason : undefined;
    
    await profile.save();
    
    await Promise.all([
      deleteCache(`listener:${profile.userId}`),
      bumpCacheVersion('listeners')
    ]);

    // In a real app, send push notification/email to listener here
    return profile;
  }
}

export default new ListenerService();
