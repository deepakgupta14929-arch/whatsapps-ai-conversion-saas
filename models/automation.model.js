// models/automation.model.js
const mongoose = require("mongoose");

const automationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  enabled: { type: Boolean, default: true },

  followUps: [
    {
      delayHours: Number,
      message: String,
      channel: { type: String, enum: ["whatsapp", "email"] },
    },
  ],

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Automation", automationSchema);
