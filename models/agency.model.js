// models/agency.model.js
const mongoose = require("mongoose");

const agencySchema = new mongoose.Schema({
  name: String,
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  plan: { type: String, default: "free" },  // free / pro / agency
});

module.exports = mongoose.model("Agency", agencySchema);
