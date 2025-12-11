// inside routes/leads.api.routes.js (or similar)
// This returns the lead document with messages in the shape frontend expects
const express = require("express");
const router = express.Router();
const Lead = require("../models/lead.model.js");

// GET /api/leads/:id/messages
router.get("/:id/messages", async (req, res) => {
  try {
    const id = req.params.id;
    const lead = await Lead.findById(id).lean();

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    // return exactly the shape frontend expects
    return res.json({
      leadId: lead._id,
      name: lead.name,
      phone: lead.phone,
      messages: (lead.messages || []).map((m) => ({
        from: m.from,
        text: m.text,
        at: m.at,
      })),
      budget: lead.budget,
      useCase: lead.useCase,
      timeline: lead.timeline,
      aiUrgency: lead.aiUrgency,
      aiIntent: lead.aiIntent,
      isFake: lead.isFake,
      fakeReason: lead.fakeReason,
    });
  } catch (err) {
    console.error("GET /api/leads/:id/messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
