import mongoose from 'mongoose';

const levelConfigSchema = new mongoose.Schema(
  {
    level: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
    },
    xpRequired: {
      type: Number,
      required: true,
      min: 0,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    badge: {
      type: String,
      trim: true,
    },
    rewards: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Reward',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// `level` uniqueness comes from field-level `unique: true` — do not redeclare here
levelConfigSchema.index({ isActive: 1 });

const LevelConfig = mongoose.model('LevelConfig', levelConfigSchema);
export default LevelConfig;
