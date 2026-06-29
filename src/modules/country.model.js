import mongoose from 'mongoose';

const countrySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    // ISO 3166-1 alpha-2 code, e.g. "IN", "US"
    code: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
    },
    // International dialing code, e.g. "+91". This is what the app sends at
    // login/register time, so we resolve the country from it.
    dialCode: {
      type: String,
      unique: true,
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

countrySchema.index({ isActive: 1 });

const Country = mongoose.model('Country', countrySchema);
export default Country;
