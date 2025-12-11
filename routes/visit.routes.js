// routes/visit.routes.js
const express = require("express");
const Visit = require("../models/visit.model"); // adjust path if different
const Lead = require("../models/lead.model");   // to verify lead existence

const router = express.Router();

// Body parser requirement: ensure app.js uses express.json() (see notes below)

// POST /api/visits/:leadId/book  -> create a visit for a lead
router.post("/:leadId/book", async (req, res) => {
  try {
    const { leadId } = req.params;
    const { date, timeSlot, familyComing, pickupRequired, notes, source } = req.body;

    // Basic validation
    if (!date || !timeSlot) {
      return res.status(400).json({ error: "Missing required fields: date or timeSlot" });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const visit = await Visit.create({
      leadId,
      agencyId: lead.agencyId || null,
      assignedAgentId: lead.assignedTo || null,
      date,
      timeSlot,
      familyComing: !!familyComing,
      pickupRequired: !!pickupRequired,
      notes: notes || "",
      source: source || "WhatsApp",
      visitStatus: "pending",
    });

    // Return the newly created visit (with populated lead)
    const populated = await Visit.findById(visit._id).populate("leadId");

    return res.json({ ok: true, visit: populated });
  } catch (err) {
    console.error("Visit create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/visits/lead/:leadId - get visits for a single lead (newest first)
router.get("/lead/:leadId", async (req, res) => {
  try {
    const { leadId } = req.params;

    const visits = await Visit.find({ leadId: leadId })
      .sort({ date: -1, createdAt: -1 })
      .populate("leadId"); // populate for frontend convenience

    res.json({ ok: true, visits });
  } catch (err) {
    console.error("fetch visits by lead error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Optional: GET /api/visits -> return all visits (admin/debug)
router.get("/", async (req, res) => {
  try {
    const visits = await Visit.find().sort({ date: -1 }).populate("leadId");
    res.json({ ok: true, visits });
  } catch (err) {
    console.error("fetch all visits error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
