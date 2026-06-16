import mongoose from 'mongoose';

const avatarSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    priceType: {
      type: String,
      enum: ['FREE', 'PAID'],
      default: 'FREE',
      required: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      enum: ['REGULAR', 'PREMIUM', 'SPECIAL'],
      default: 'REGULAR',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for active/pricing lookups
avatarSchema.index({ isActive: 1, priceType: 1 });

const Avatar = mongoose.model('Avatar', avatarSchema);
export default Avatar;
