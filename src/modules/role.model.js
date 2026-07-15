import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    /** Denormalized permission codes for fast authorize() checks */
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    isSystemRole: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

roleSchema.index({ isSystemRole: 1, isActive: 1 });
roleSchema.index({ isActive: 1, name: 1 });

const Role = mongoose.model('Role', roleSchema);
export default Role;
