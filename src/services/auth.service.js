import bcrypt from 'bcrypt';
import userRepository from '../repositories/user.repository.js';
import countryRepository from '../repositories/country.repository.js';
import User from '../modules/user.model.js';
import { generateToken } from '../utils/jwt.util.js';
import { storeOtpSession, verifyAndConsumeOtpSession, deleteCache } from '../utils/redis.util.js';
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

    const token = generateToken({ id: user._id, type: user.type });
    return { token, user, isNewUser };
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

    const token = generateToken({ id: user._id, type: user.type });
    return { token, user, isNewUser };
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
    if (!user) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password');
    }

    if (user.isBlocked) throw new ApiError(403, 'Your account has been blocked.');
    if (user.isDeleted) throw new ApiError(403, 'Your account has been deleted.');

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
