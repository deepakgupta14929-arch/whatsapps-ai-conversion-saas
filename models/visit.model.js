const mongoose = require("mongoose");

const VisitSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency" },
    assignedAgentId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    date: { type: Date, required: true },
    timeSlot: { type: String }, // "morning" | "afternoon" | "evening"

    visitStatus: {
      type: String,
      enum: ["pending", "confirmed", "completed", "cancelled"],
      default: "pending",
    },

    familyComing: { type: Boolean, default: false },
    pickupRequired: { type: Boolean, default: false },
    notes: { type: String },
    source: { type: String, default: "WhatsApp" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Visit", VisitSchema);
