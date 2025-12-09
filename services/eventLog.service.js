// services/eventLog.service.js
const EventLog = require("../models/eventLog.model");

async function logEvent({ agencyId, userId, leadId, type, meta = {} }) {
  try {
    await EventLog.create({
      agencyId,
      userId,
      leadId,
      type,
      meta,
    });
  } catch (err) {
    console.error("EventLog error:", err.message || err);
  }
}

module.exports = { logEvent };
