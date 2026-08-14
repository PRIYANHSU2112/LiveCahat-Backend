import bcrypt from 'bcrypt';
import userRepository from '../repositories/user.repository.js';
import countryRepository from '../repositories/country.repository.js';
import User from '../modules/user.model.js';
import { generateToken, generateAuthTokens, verifyRefreshToken } from '../utils/jwt.util.js';
import {
  storeOtpSession,
  verifyAndConsumeOtpSession,
  deleteCache,
  storeRefreshTokenInRedis,
  isRefreshTokenValidInRedis,
  revokeRefreshTokenInRedis
} from '../utils/redis.util.js';
import ApiError from '../utils/ApiError.js';

class AuthService {
  /**
   * Create a new user. If a valid inviteCode is supplied, create + reward
   * (referrer and referred) atomically inside a transaction.
   */
  async _createUser(userData, inviteCode) {
    const code = (inviteCode || '').trim().toUpperCase();
    let agentIdForListener = null;

    if (code) {
      const referrer = await User.findOne({ inviteCode: code, isDeleted: false }).select('_id type');
      if (!referrer) throw new ApiError(400, 'Invalid referral or invite code.');

      if (userData.type === 'CUSTOMER') {
        // Link only — the bonus is paid on the friend's first coin purchase
        userData.referredBy = referrer._id;
      } else if (userData.type === 'LISTENER') {
        // If referrer is AGENT, link listener to Agent.
        // If referrer is ADMIN, agentIdForListener remains null (Direct Admin Listener).
        if (referrer.type === 'AGENT') {
          agentIdForListener = referrer._id;
        }
      }
    }

    const user = await userRepository.create(userData);

    // Ensure a ListenerProfile exists when a new LISTENER account registers
    if (userData.type === 'LISTENER') {
      const ListenerProfile = (await import('../modules/listener-profile.model.js')).default;
      const crypto = await import('crypto');
      const magicLoginToken = crypto.randomBytes(32).toString('hex');

      await ListenerProfile.create({
        userId: user._id,
        createdByAgentId: agentIdForListener,
        profileStatus: 'incomplete',
        kycStatus: 'PENDING',
        magicLoginToken,
        country: userData.country || null,
      });
    }

    return user;
  }

  _assertListenerGender(type, gender) {
    if (type === 'LISTENER' && gender !== 'FEMALE') {
      throw new ApiError(400, 'Listeners must select female gender');
    }
  }

  _assertAdultAge(age) {
    const n = Number(age);
    if (!Number.isInteger(n) || n < 18) {
      throw new ApiError(403, 'You must be 18 or older to use this app.');
    }
    return n;
  }

  _resolveLoginProfile(session, { type, gender, age }) {
    if (type && type !== session.type) {
      throw new ApiError(400, 'Login details do not match the OTP request. Please request a new OTP.');
    }

    if (gender && gender !== session.gender) {
      throw new ApiError(400, 'Login details do not match the OTP request. Please request a new OTP.');
    }

    if (age !== undefined && Number(age) !== Number(session.age)) {
      throw new ApiError(400, 'Login details do not match the OTP request. Please request a new OTP.');
    }

    return {
      type: session.type,
      gender: gender ?? session.gender,
      age: age ?? session.age,
    };
  }

  _profileFieldsFromLogin({ gender, age }) {
    return {
      gender,
      age: Number(age),
      ageVerified: true,
    };
  }

  async requestOtp(data) {
    const { mobileNumber, type, age, gender, countryCode } = data;

    this._assertListenerGender(type, gender);
    const verifiedAge = this._assertAdultAge(age);

    const otp = '123456';

    await storeOtpSession(mobileNumber, {
      otp,
      age: verifiedAge,
      gender,
      type,
      countryCode: countryCode || '+91',
    });

    // TODO: Send SMS via provider
    console.log(`[DEV OTP] Sent OTP ${otp} to ${mobileNumber}`);

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(data) {
    const { mobileNumber, otp, type, countryCode, inviteCode, age, gender } = data;

    const session = await verifyAndConsumeOtpSession(mobileNumber, otp);
    const profile = this._resolveLoginProfile(session, { type, gender, age });
    const profileFields = this._profileFieldsFromLogin(profile);

    let user = await userRepository.findByMobile(mobileNumber);
    let isNewUser = false;

    if (!user) {
      const country = await countryRepository.findByDialCode(countryCode);
      user = await this._createUser(
        {
          mobileNumber,
          type: profile.type,
          countryCode,
          country: country?._id || null,
          ...profileFields,
        },
        inviteCode
      );
      isNewUser = true;
    } else {
      if (user.isBlocked) throw new ApiError(403, 'Your account is blocked.');
      if (user.isDeleted) throw new ApiError(403, 'Your account is deleted.');

      user = await userRepository.updateById(user._id, profileFields);
      await deleteCache(`auth:user:${user._id}`);
    }

    const { token, refreshToken } = generateAuthTokens({ id: user._id, type: user.type });
    await storeRefreshTokenInRedis(user._id.toString(), refreshToken);
    return { token, refreshToken, user, isNewUser };
  }

  async guestLogin({ deviceId, age, inviteCode }) {
    const verifiedAge = this._assertAdultAge(age);

    let user = await userRepository.findByDeviceId(deviceId);
    let isNewUser = false;

    if (!user) {
      user = await this._createUser(
        {
          type: 'CUSTOMER',
          isGuest: true,
          deviceId,
          age: verifiedAge,
          ageVerified: true,
        },
        inviteCode
      );
      isNewUser = true;
    } else {
      if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked.');
      // Refresh declared age on returning guest
      user = await userRepository.updateById(user._id, { age: verifiedAge, ageVerified: true });
      await deleteCache(`auth:user:${user._id}`);
    }

    const { token, refreshToken } = generateAuthTokens({ id: user._id, type: user.type });
    await storeRefreshTokenInRedis(user._id.toString(), refreshToken);
    return { token, refreshToken, user, isNewUser };
  }

  async linkAccount({ userId, mobileNumber, otp, countryCode }) {
    const session = await verifyAndConsumeOtpSession(mobileNumber, otp);

    const existing = await userRepository.findByMobile(mobileNumber);
    if (existing && existing._id.toString() !== userId.toString()) {
      throw new ApiError(409, 'This phone number is already linked to another account.');
    }

    const updatePayload = {
      mobileNumber,
      isGuest: false,
      gender: session.gender,
      age: Number(session.age),
      ageVerified: true,
    };

    if (countryCode) {
      const country = await countryRepository.findByDialCode(countryCode);
      updatePayload.countryCode = countryCode;
      updatePayload.country = country?._id || null;
    }

    const user = await userRepository.updateById(userId, updatePayload);
    await deleteCache(`auth:user:${userId}`);
    return { user };
  }

  async login(data) {
    const { email, password } = data;

    const user = await userRepository.findOne(
      { email, type: { $in: ['ADMIN', 'AGENT'] } },
      '+password',
      { path: 'roleId', select: 'name slug' },
    );
    if (!user || !user.password || !password) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password');
    }

    if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked.');
    if (user.isDeleted) throw new ApiError(403, 'Your account has been deleted.');

    const { token, refreshToken } = generateAuthTokens({ id: user._id, type: user.type });
    await storeRefreshTokenInRedis(user._id.toString(), refreshToken);

    // Remove password from response
    user.password = undefined;

    return { token, refreshToken, user };
  }

  async directLogin({ token }) {
    if (!token) throw new ApiError(400, 'Token is required');

    const ListenerProfile = (await import('../modules/listener-profile.model.js')).default;
    const profile = await ListenerProfile.findOne({ magicLoginToken: token });
    if (!profile) throw new ApiError(404, 'Invalid magic login token');

    const user = await userRepository.findById(profile.userId);
    if (!user) throw new ApiError(404, 'User associated with this token not found');

    if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked.');
    if (user.isDeleted) throw new ApiError(403, 'Your account has been deleted.');

    const { token: jwtToken, refreshToken } = generateAuthTokens({ id: user._id, type: user.type });
    await storeRefreshTokenInRedis(user._id.toString(), refreshToken);
    return { token: jwtToken, refreshToken, user };
  }

  async refreshToken({ refreshToken }) {
    if (!refreshToken) throw new ApiError(400, 'Refresh token is required');

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      throw new ApiError(401, 'Invalid or expired refresh token');
    }

    const userId = decoded.id;
    const isValidInRedis = await isRefreshTokenValidInRedis(userId, refreshToken);
    if (!isValidInRedis) {
      throw new ApiError(401, 'Refresh token has been revoked or expired');
    }

    const user = await userRepository.findById(userId);
    if (!user) throw new ApiError(404, 'User not found');
    if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked.');
    if (user.isDeleted) throw new ApiError(403, 'Your account has been deleted.');

    // Revoke old refresh token (token rotation)
    await revokeRefreshTokenInRedis(userId, refreshToken);

    // Generate new token pair
    const { token: newAccessToken, refreshToken: newRefreshToken } = generateAuthTokens({ id: user._id, type: user.type });
    await storeRefreshTokenInRedis(user._id.toString(), newRefreshToken);

    return { token: newAccessToken, refreshToken: newRefreshToken, user };
  }

  async logout({ userId, refreshToken }) {
    if (userId && refreshToken) {
      await revokeRefreshTokenInRedis(userId, refreshToken);
    }
    if (userId) {
      await deleteCache(`auth:user:${userId}`);
    }
    return { message: 'Logged out successfully' };
  }
}

export default new AuthService();
