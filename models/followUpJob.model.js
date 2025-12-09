// models/followUpJob.model.js
const mongoose = require("mongoose");

const followUpJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },

  channel: { type: String, enum: ["whatsapp", "email"], default: "whatsapp" },
  message: String,
  runAt: Date,
  sent: { type: Boolean, default: false },
  sentAt: Date,
});

module.exports = mongoose.model("FollowUpJob", followUpJobSchema);
