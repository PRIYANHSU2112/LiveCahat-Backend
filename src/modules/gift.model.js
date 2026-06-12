import mongoose from 'mongoose';

const giftSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    coin: {
      type: Number,
      required: true,
      min: 0,
    },
    earningPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 70, // Listener receives 70% of the gift's value as earnings
    },
    adminPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 30, // Platform keeps 30% of the gift's value
    },
    icon: {
      type: String, // URL of the gift icon/image
      required: true,
    },
    category: {
      type: String,
      enum: ['REGULAR', 'PREMIUM', '18+', 'SPECIAL'],
      default: 'REGULAR',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index to quickly search active/categorized gifts
giftSchema.index({ isActive: 1, category: 1 });

const Gift = mongoose.model('Gift', giftSchema);
export default Gift;
