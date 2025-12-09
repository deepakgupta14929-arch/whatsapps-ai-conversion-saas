// routes/leads.api.routes.js
const express = require("express");
const router = express.Router();

const Lead = require("../models/lead.model");
const User = require("../models/user.model");
const { sendWhatsAppText } = require("../services/whatsapp.service");
const { logEvent } = require("../services/eventLog.service");

// Must be logged in
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// POST /api/leads/:id/reply  { message: string }
router.post("/api/leads/:id/reply", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    const lead = await Lead.findOne({
      _id: req.params.id,
      agencyId: user.agencyId,
    });

    if (!lead) {
      return res.status(404).json({ ok: false, error: "Lead not found" });
    }

    if (!lead.phone) {
      return res
        .status(400)
        .json({ ok: false, error: "Lead has no phone number" });
    }

    const text = (req.body.message || "").trim();
    if (!text) {
      return res.status(400).json({ ok: false, error: "Empty message" });
    }

    const waResult = await sendWhatsAppText(user, lead.phone, text);
    console.log("API reply WA result:", waResult);

    // if stage was new, mark contacted
    if (lead.stage === "new") {
      lead.stage = "contacted";
    }

    lead.messages.push({
      from: "agent",
      text,
      at: new Date(),
    });
    lead.lastMessage = text;
    await lead.save();

    await logEvent({
      agencyId: lead.agencyId,
      userId: user._id,
      leadId: lead._id,
      type: "whatsapp_out_agent",
      meta: {
        direction: "out",
        messageSnippet: text.slice(0, 120),
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("API /api/leads/:id/reply error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});


// GET /api/leads/:id  → return lead + messages
router.get("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) {
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    const lead = await Lead.findOne({
      _id: req.params.id,
      agencyId: user.agencyId,
    }).lean();

    if (!lead) {
      return res.status(404).json({ ok: false, error: "Lead not found" });
    }

    return res.json({ ok: true, lead });
  } catch (err) {
    console.error("GET /api/leads/:id error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});
// 📌 Fetch full chat messages + AI info + qualification fields
router.get("/:id/messages", async (req, res) => {
  try {
    const leadId = req.params.id;
    if (!leadId) {
      return res.status(400).json({ error: "Missing leadId" });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    return res.json({
      leadId: lead._id,
      name: lead.name,
      phone: lead.phone,
      messages: lead.messages || [],
      stage: lead.stage,
      score: lead.score,

      // ⭐ Real-estate qualification fields
      budget: lead.budget,
      timeline: lead.timeline,
      useCase: lead.useCase,

      // ⭐ AI intelligence fields
      qualificationLevel: lead.qualificationLevel,
      aiIntent: lead.aiIntent,
      aiUrgency: lead.aiUrgency,
      willBuyScore: lead.willBuyScore,
      willRespondScore: lead.willRespondScore,
      priorityLevel: lead.priorityLevel,
      engagementNotes: lead.engagementNotes,

      // ⭐ Fake detection
      isFake: lead.isFake,
      fakeReason: lead.fakeReason,
    });
  } catch (err) {
    console.error("GET /api/leads/:id/messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


module.exports = router;
