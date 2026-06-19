import mongoose from 'mongoose';

const stickerCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
    },
    icon: {
      type: String, // URL of the category thumbnail/cover image
    },
    description: {
      type: String,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0, // Lower values appear first in listings
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

// Index for active/ordered category listings
stickerCategorySchema.index({ isActive: 1, sortOrder: 1 });

const StickerCategory = mongoose.model('StickerCategory', stickerCategorySchema);
export default StickerCategory;
