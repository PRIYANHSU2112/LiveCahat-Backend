import bcrypt from 'bcrypt';
import userRepository from '../repositories/user.repository.js';
import { generateToken } from '../utils/jwt.util.js';
import { storeOTP, verifyOTP } from '../utils/redis.util.js';
import ApiError from '../utils/ApiError.js';

class AuthService {
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
    const { mobileNumber, otp, type } = data;

    const validOtp = await verifyOTP(mobileNumber, otp);
    if (!validOtp) {
      throw new ApiError(401, 'Invalid OTP');
    }

    let user = await userRepository.findByMobile(mobileNumber);
    let isNewUser = false;

    if (!user) {
      user = await userRepository.create({
        mobileNumber,
        type,
      });
      isNewUser = true;
    } else {
      if (user.isBlocked) throw new ApiError(403, 'Your account is blocked.');
      if (user.isDeleted) throw new ApiError(403, 'Your account is deleted.');
    }

    const token = generateToken({ id: user._id, type: user.type });
    return { token, user, isNewUser };
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
}

export default new AuthService();
