
//const Event = require("../models/event.model");
const EventLog = require("../models/eventLog.model");

/**
 * logEvent({ agencyId, userId, leadId, type, meta, ip, source })
 * Stores an event and returns created document.
 */
async function logEvent({ agencyId, userId, leadId, type, meta = {}, ip = null, source = null }) {
  try {
    const ev = await EventLog.create({
      agencyId: agencyId || null,
      userId: userId || null,
      leadId: leadId || null,
      type,
      meta,
      ip,
      source,
    });
    // console.debug("Event logged:", type, ev._id);
    return ev;
  } catch (err) {
    // don't crash the caller — log server-side
    console.error("logEvent error:", err);
    return null;
  }
}

module.exports = { logEvent };
