import mongoose from 'mongoose';

const languageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    code: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
    },
    nativeName: {
      type: String,
      trim: true,
    },
    flagUrl: {
      type: String,
      trim: true,
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

const Language = mongoose.model('Language', languageSchema);
export default Language;
