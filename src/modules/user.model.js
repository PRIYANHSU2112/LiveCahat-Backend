import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['CUSTOMER', 'LISTENER', 'ADMIN'],
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

// Indexes
userSchema.index({ type: 1 });
userSchema.index({ isDeleted: 1 });

const User = mongoose.model('User', userSchema);
export default User;
