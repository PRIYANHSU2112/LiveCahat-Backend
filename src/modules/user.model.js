import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

// Generate a referral invite code: 3 uppercase letters + 4 digits (e.g. BOY3526)
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const generateInviteCode = () => {
  let code = '';
  for (let i = 0; i < 3; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  for (let i = 0; i < 4; i++) code += Math.floor(Math.random() * 10);
  return code;
};

const userSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['CUSTOMER', 'LISTENER', 'AGENT', 'ADMIN'],
      default: 'CUSTOMER',
      required: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    username: {
      type: String,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    email: {
      type: String,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    mobileNumber: {
      type: String,
      sparse: true,
      trim: true,
    },
    countryCode: {
      type: String,
      trim: true,
    },
    // Resolved Country reference (set from `countryCode` at register/login time)
    country: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Country',
      default: null,
    },
    password: {
      type: String,
      select: false,
    },
    profileImage: {
      type: String,
    },
    gender: {
      type: String,
      enum: ['MALE', 'FEMALE', 'OTHER'],
    },
    dateOfBirth: {
      type: Date,
    },
    // Declared age at signup/login (years). Preferred over dateOfBirth for auth flows.
    age: {
      type: Number,
      min: 18,
      max: 120,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      default: null,
    },
    languages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Language',
      },
    ],
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
    },
    profileCompleted: {
      type: Boolean,
      default: false,
    },
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isBlocked: {
      type: Boolean,
      default: false
    },
    // Timestamp of when the user was most recently blocked (null when not blocked).
    // Powers the agent panel "blocked this month" / month-over-month trend cards.
    blockedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    followingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    unlockedAvatars: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Avatar',
      },
    ],
    unlockedStickers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sticker',
      },
    ],
    isGuest: {
      type: Boolean,
      default: false,
    },
    deviceId: {
      type: String,
      trim: true,
    },
    ageVerified: {
      type: Boolean,
      default: false,
    },
    // XP & Level System
    totalXp: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentLevel: {
      type: Number,
      default: 1,
      min: 1,
    },
    badges: [
      {
        type: String,
      },
    ],
    // One-time XP guard flags
    profileXpAwarded: {
      type: Boolean,
      default: false,
    },
    firstCallDone: {
      type: Boolean,
      default: false,
    },
    // Referral System
    inviteCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    referralCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralRewardAwarded: {
      type: Boolean,
      default: false, // Ensures the sign-up referral reward is paid out only once
    },
    commissionPercentage: {
      type: Number,
      default: 0.0,
      min: 0,
      max: 100,
    },
    // User preference toggles (notifications, call availability, DND)
    settings: {
      notifications: { type: Boolean, default: true },
      acceptIncomingCalls: { type: Boolean, default: true },
      dndChats: { type: Boolean, default: false },
      dndVoiceCall: { type: Boolean, default: false },
      dndVideoCall: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual field for fullName
userSchema.virtual('fullName').get(function () {
  return `${this.firstName || ''} ${this.lastName || ''}`.trim();
});

// Password Hash Hook
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Generate a unique invite code for new users (retry on collision)
userSchema.pre('save', async function (next) {
  if (this.inviteCode) return next();
  try {
    let code;
    let exists = true;
    let attempts = 0;
    while (exists && attempts < 5) {
      code = generateInviteCode();
      exists = await this.constructor.exists({ inviteCode: code });
      attempts++;
    }
    this.inviteCode = code;
    next();
  } catch (error) {
    next(error);
  }
});

// Indexes
userSchema.index({ type: 1 });
userSchema.index({ type: 1, createdAt: -1 });
userSchema.index({ type: 1, isDeleted: 1, createdAt: -1 });
userSchema.index({ type: 1, lastSeen: -1 });
userSchema.index({ type: 1, isDeleted: 1, lastSeen: -1 });
userSchema.index({ isDeleted: 1 });
userSchema.index({ deviceId: 1 }, { sparse: true });
userSchema.index({ currentLevel: 1 });
userSchema.index({ totalXp: -1 });
userSchema.index({ country: 1 });

const User = mongoose.model('User', userSchema);
export default User;
