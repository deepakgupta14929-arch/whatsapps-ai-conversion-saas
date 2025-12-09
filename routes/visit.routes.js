const express = require("express");
const Visit = require("../models/visit.model");
const Lead = require("../models/lead.model");

const router = express.Router();

// POST /api/visits/:leadId/book
router.post("/:leadId/book", async (req, res) => {
  try {
    // safety: check body exists
    if (!req.body) {
      return res.status(400).json({ error: "Request body missing" });
    }

    const { leadId } = req.params;
    const {
      date,
      timeSlot,
      familyComing,
      pickupRequired,
      notes,
    } = req.body;

    // basic validation
    if (!date || !timeSlot) {
      return res
        .status(400)
        .json({ error: "date and timeSlot are required" });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const visit = await Visit.create({
      leadId,
      agencyId: lead.agencyId,
      assignedAgentId: lead.assignedTo,
      date,
      timeSlot,
      familyComing: Boolean(familyComing),
      pickupRequired: Boolean(pickupRequired),
      notes,
    });

    return res.json({ ok: true, visit });
  } catch (err) {
    console.error("Visit create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/visits  – list visits for current agency
// routes/visit.routes.js
router.get("/", async (req, res) => {
  try {
    const filter = {};

    // In real app: filter by agency
    if (req.agencyId) {
      filter.agencyId = req.agencyId;
    }

 const visits = await Visit.find({ agencyId: req.agencyId })
      .populate("leadId")
      .sort({ date: -1, createdAt: -1 });   // ⬅️ newest first
    return res.json({ visits });
  } catch (err) {
    console.error("Load visits error:", err);
    res.status(500).json({ error: "Failed to load visits" });
  }
});
// at bottom of routes/visit.routes.js, before module.exports:
router.get("/debug/all", async (req, res) => {
  try {
    const visits = await Visit.find().populate("leadId");
    res.json({ visits });
  } catch (err) {
    console.error("Debug visits error:", err);
    res.status(500).json({ error: "Debug route failed" });
  }
});

module.exports = router;
