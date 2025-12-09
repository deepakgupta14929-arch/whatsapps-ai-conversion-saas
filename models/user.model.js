// models/user.model.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  passwordHash: String,
  businessType: String,
  createdAt: { type: Date, default: Date.now },

  whatsappAccessToken: String,
  phoneNumberId: String,
  whatsappConnected: { type: Boolean, default: false },

  brandName: String,
  websiteUrl: String,
  targetCountry: String,
  primaryOffer: String,

  whatsappGreeting: String,
  aiTone: { type: String, default: "Friendly" },
  aiNotes: String,

  onboardingCompleted: { type: Boolean, default: false },

  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency" },

  role: {
    type: String,
    enum: ["owner", "admin", "agent"],
    default: "owner",
  },
  isActive: { type: Boolean, default: true },
  lastAssignedAt: { type: Date, default: null },
});

module.exports = mongoose.model("User", userSchema);
