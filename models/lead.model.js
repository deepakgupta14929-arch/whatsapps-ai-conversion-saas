// models/lead.model.js
const mongoose = require("mongoose");
// leadSchema.index({ agencyId: 1, createdAt: -1 });
// leadSchema.index({ agencyId: 1, phone: 1 });
// leadSchema.index({ agencyId: 1, stage: 1 });
// leadSchema.index({ assignedTo: 1, agencyId: 1 });

const leadSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency" },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  name: String,
  email: String,
  phone: String,
  message: String,
  source: { type: String, default: "Contact form" },
  createdAt: { type: Date, default: Date.now },

  qualificationLevel: {
    type: String,
    enum: ["new", "cold", "warm", "hot"],
    default: "new",
  },

  stage: {
    type: String,
    enum: ["new", "contacted", "qualified", "hot", "closed","lost"],
    default: "new"
  },

  budget: String,
  timeline: String,
  useCase: String,
  lastMessage: String,

  score: { type: Number, default: null },

  aiIntent: String,
  aiUrgency: String,
  aiNotes: String,
  aiTags: [String],

  isFake: { type: Boolean, default: false },
  fakeReason: String,

  willRespondScore: { type: Number, default: null },
  willBuyScore:     { type: Number, default: null },
  priorityLevel: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "medium",
  },
  engagementNotes: String,

  messages: [
    {
      from: String,
      text: String,
      at: { type: Date, default: Date.now },
    },
  ],

  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  isConverted: { type: Boolean, default: false },
  convertedAt: Date,
});

module.exports = mongoose.model("Lead", leadSchema);
