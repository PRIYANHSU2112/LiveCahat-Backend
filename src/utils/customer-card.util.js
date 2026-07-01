/**
 * Shared customer card formatter for listener-home APIs and socket events.
 */

export const formatCustomerCard = (user, presence = {}, extra = {}) => {
  const id = user._id?.toString() || user.id?.toString();
  const liveStatus = presence.liveStatus ?? (user.isOnline ? 'ONLINE' : 'OFFLINE');
  const isOnline = presence.isOnline ?? liveStatus !== 'OFFLINE';

  return {
    id,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImage: user.profileImage,
    gender: user.gender,
    countryCode: user.countryCode,
    currentLevel: user.currentLevel || 1,
    totalXp: user.totalXp || 0,
    isOnline,
    liveStatus,
    ...extra,
  };
};

export const overlayPresenceOnCards = (docs, statusMap, redisAvailable = true) =>
  docs.map((user) => {
    const id = user._id?.toString() || user.id?.toString();
    let liveStatus = statusMap.get(id) || 'OFFLINE';

    if (!redisAvailable) {
      liveStatus = user.isOnline ? 'ONLINE' : 'OFFLINE';
    }

    const { _id, ...rest } = user;
    return formatCustomerCard(
      { ...rest, id },
      { liveStatus, isOnline: liveStatus !== 'OFFLINE' },
      user.lastInteractionAt ? { lastInteractionAt: user.lastInteractionAt } : {}
    );
  });

export const buildSectionResponse = (docs, total, page, limit) => ({
  docs,
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit) || 0,
});
