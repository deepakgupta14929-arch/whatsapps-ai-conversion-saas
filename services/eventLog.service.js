// // services/eventLog.service.js
// const mongoose = require("mongoose");

// const eventSchema = new mongoose.Schema({
//   agencyId: mongoose.Schema.Types.ObjectId,
//   userId: mongoose.Schema.Types.ObjectId,
//   leadId: mongoose.Schema.Types.ObjectId,
//   type: String,
//   meta: Object,
//   createdAt: { type: Date, default: Date.now },
// });

// const EventLog = require("../models/eventLog.model");

// async function logEvent({ agencyId, userId, leadId, type, meta = {} }) {
//   try {
//     await EventLog.create({
//       agencyId,
//       userId,
//       leadId,
//       type,
//       meta,
//     });
//   } catch (err) {
//     console.error("EventLog error:", err.message || err);
//   }
// }

// module.exports = { logEvent,EventLog };
// services/eventLog.service.js
const Event = require("../models/event.model");

/**
 * logEvent({ agencyId, userId, leadId, type, meta, ip, source })
 * Stores an event and returns created document.
 */
async function logEvent({ agencyId, userId, leadId, type, meta = {}, ip = null, source = null }) {
  try {
    const ev = await Event.create({
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
