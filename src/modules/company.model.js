import mongoose from 'mongoose';

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    logo: {
      type: String, // URL to the main company logo
      trim: true,
    },
    favicon: {
      type: String, // URL to the favicon
      trim: true,
    },
    tagline: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    subEmail: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    phoneAlt: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },

    // Social media links
    socialLinks: {
      facebook: {
        type: String,
        trim: true,
      },
      instagram: {
        type: String,
        trim: true,
      },
      twitter: {
        type: String,
        trim: true,
      },
      linkedin: {
        type: String,
        trim: true,
      },
      youtube: {
        type: String,
        trim: true,
      },
    },
    // Legal & Company Policies
    policies: {
      privacyPolicy: {
        type: String, // Text, HTML, Markdown or external URL
        trim: true,
      },
      termsAndConditions: {
        type: String, // Text, HTML, Markdown or external URL
        trim: true,
      },
      refundPolicy: {
        type: String, // Text, HTML, Markdown or external URL
        trim: true,
      },
      aboutUs: {
        type: String,
        trim: true,
      },
      contactUs: {
        type: String,
        trim: true,
      },
    },
    // Support details
    supportEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    supportPhone: {
      type: String,
      trim: true,
    },
    gstin: {
      type: String, // GST Identification Number if applicable
      trim: true,
    },
    cin: {
      type: String, // Corporate Identification Number if applicable
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Company = mongoose.model('Company', companySchema);
export default Company;
