// routes/coach.routes.js
const express = require("express");
const router = express.Router();

const Lead = require("../models/lead.model");
const User = require("../models/user.model");
const { getSalesCoachAdvice } = require("../services/ai.service");

// Simple auth middleware for API
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// GET /api/coach/:leadId
router.get("/api/coach/:leadId", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(401).json({ ok: false, error: "User not found" });
    }

    // Make sure lead belongs to this user/agency
    const lead = await Lead.findOne({
      _id: req.params.leadId,
      agencyId: user.agencyId,
    }).lean();

    if (!lead) {
      return res.status(404).json({ ok: false, error: "Lead not found" });
    }

    const advice = await getSalesCoachAdvice(lead);
    if (!advice) {
      return res.json({ ok: false, error: "AI coach not available" });
    }

    return res.json({ ok: true, advice });
  } catch (err) {
    console.error("Coach API error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;

