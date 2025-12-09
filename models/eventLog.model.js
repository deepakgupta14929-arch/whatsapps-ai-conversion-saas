// models/eventLog.model.js
const mongoose = require("mongoose");

// eventLogSchema.index({ agencyId: 1, createdAt: -1 });
// eventLogSchema.index({ type: 1, agencyId: 1 });


const eventLogSchema = new mongoose.Schema(
  {
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", index: true },
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },   // who did it (optional)
    leadId:   { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },   // which lead (optional)

    type: {
      type: String,
      enum: [
        "lead_created",
        "lead_updated",
        "stage_changed",
        "whatsapp_in",
        "whatsapp_out_ai",
        "whatsapp_out_agent",
        "followup_scheduled",
        "followup_sent",
        "lead_assigned",
        "lead_converted",
        "lead_lost",
      ],
      required: true,
    },

    // Optional extra info
    meta: {
      fromStage: String,
      toStage: String,
      channel: String,    // whatsapp / email
      direction: String,  // in / out
      messageSnippet: String,
      notes: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EventLog", eventLogSchema);
