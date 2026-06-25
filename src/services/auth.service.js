import bcrypt from 'bcrypt';
import userRepository from '../repositories/user.repository.js';
import countryRepository from '../repositories/country.repository.js';
import User from '../modules/user.model.js';
import { generateToken } from '../utils/jwt.util.js';
import { storeOTP, verifyOTP, deleteCache } from '../utils/redis.util.js';
import ApiError from '../utils/ApiError.js';

class AuthService {
  /**
   * Create a new user. If a valid inviteCode is supplied, create + reward
   * (referrer and referred) atomically inside a transaction.
   */
  async _createUser(userData, inviteCode) {
    const code = (inviteCode || '').trim().toUpperCase();
    if (!code) {
      return await userRepository.create(userData);
    }

    // Referral codes are customer-only (a listener cannot be referred)
    if (userData.type !== 'CUSTOMER') {
      throw new ApiError(400, 'Referral codes can only be used by customer accounts.');
    }

    const referrer = await User.findOne({ inviteCode: code, isDeleted: false }).select('_id');
    if (!referrer) throw new ApiError(400, 'Invalid referral code.');

    // Link only — the bonus is paid on the friend's first coin purchase
    return await userRepository.create({ ...userData, referredBy: referrer._id });
  }
  async requestOtp(data) {
    const { mobileNumber, type } = data;

    // In a real app, integrate MSG91 or Twilio here.
    // For now, generate a random 6-digit OTP (or static for dev)
    // const otp = process.env.NODE_ENV === 'development' ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
    const otp = '123456'

    await storeOTP(mobileNumber, otp);

    // TODO: Send SMS via provider
    console.log(`[DEV OTP] Sent OTP ${otp} to ${mobileNumber}`);

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(data) {
    const { mobileNumber, otp, type, countryCode, inviteCode } = data;

    const validOtp = await verifyOTP(mobileNumber, otp);
    if (!validOtp) {
      throw new ApiError(401, 'Invalid OTP');
    }

    let user = await userRepository.findByMobile(mobileNumber);
    let isNewUser = false;

    if (!user) {
      // Resolve the country from the dialing code supplied at register time.
      const country = await countryRepository.findByDialCode(countryCode);
      user = await this._createUser(
        { mobileNumber, type, countryCode, country: country?._id || null },
        inviteCode
      );
      isNewUser = true;
    } else {
      if (user.isBlocked) throw new ApiError(403, 'Your account is blocked.');
      if (user.isDeleted) throw new ApiError(403, 'Your account is deleted.');
    }

    const token = generateToken({ id: user._id, type: user.type });
    return { token, user, isNewUser };
  }

  async guestLogin({ deviceId, dateOfBirth, inviteCode }) {
    const dob = new Date(dateOfBirth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    if (age < 18) throw new ApiError(403, 'You must be 18 or older to use this app.');

    let user = await userRepository.findByDeviceId(deviceId);
    let isNewUser = false;

    if (!user) {
      user = await this._createUser(
        { type: 'CUSTOMER', isGuest: true, deviceId, ageVerified: true },
        inviteCode
      );
      isNewUser = true;
    } else {
      if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked.');
    }

    const token = generateToken({ id: user._id, type: user.type });
    return { token, user, isNewUser };
  }

  async linkAccount({ userId, mobileNumber, otp, countryCode }) {
    const validOtp = await verifyOTP(mobileNumber, otp);
    if (!validOtp) throw new ApiError(401, 'Invalid OTP');

    const existing = await userRepository.findByMobile(mobileNumber);
    if (existing && existing._id.toString() !== userId.toString()) {
      throw new ApiError(409, 'This phone number is already linked to another account.');
    }

    const updatePayload = { mobileNumber, isGuest: false };
    if (countryCode) {
      const country = await countryRepository.findByDialCode(countryCode);
      updatePayload.countryCode = countryCode;
      updatePayload.country = country?._id || null;
    }

    const user = await userRepository.updateById(userId, updatePayload);
    await deleteCache(`auth:user:${userId}`);
    return { user };
  }

  async adminLogin(data) {
    const { email, password } = data;

    const user = await userRepository.findOne({ email, type: 'ADMIN' }, '+password');
    if (!user) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const token = generateToken({ id: user._id, type: user.type });

    // Remove password from response
    user.password = undefined;

    return { token, user };
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

    const jwtToken = generateToken({ id: user._id, type: user.type });
    return { token: jwtToken, user };
  }
}

export default new AuthService();
