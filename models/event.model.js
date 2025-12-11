// models/event.model.js
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    agencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Agency", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", index: true },

    type: { type: String, required: true }, // e.g. "lead_created", "whatsapp_in", "followup_sent"
    meta: { type: mongoose.Schema.Types.Mixed }, // flexible JSON for details

    ip: String, // optional
    source: String, // optional human readable source
  },
  { timestamps: true }
);

module.exports = mongoose.model("Event", eventSchema);
