// routes/analytics.routes.js
const express = require("express");
const router = express.Router();

const User = require("../models/user.model");
const Lead = require("../models/lead.model");
const EventLog = require("../models/eventLog.model");

// Simple auth middleware just for API routes
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: "Not logged in" });
  }
  next();
}

// GET /api/analytics/summary
router.get("/api/analytics/summary", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser || !currentUser.agencyId) {
      return res.status(401).json({ ok: false, error: "User/agency not found" });
    }

    const agencyId = currentUser.agencyId;

    // --- Time windows ---
    const now = new Date();
    const since7 = new Date(now);
    since7.setDate(since7.getDate() - 6); // 7 days including today

    const since30 = new Date(now);
    since30.setDate(since30.getDate() - 30); // last 30 days events

    // --- Fetch data in parallel ---
    const [leads, events] = await Promise.all([
      Lead.find({ agencyId }).lean(),
      EventLog.find({ agencyId, createdAt: { $gte: since30 } })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

    const totalLeads = leads.length;
    const hotLeads = leads.filter((l) => l.qualificationLevel === "hot").length;
    const warmLeads = leads.filter((l) => l.qualificationLevel === "warm").length;
    const coldLeads = leads.filter((l) => l.qualificationLevel === "cold").length;
    const fakeLeads = leads.filter((l) => l.isFake).length;

    const convertedLeads = leads.filter((l) => l.isConverted).length;
    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // --- Build last 7 days trend (leads + conversions) ---
    const dayBuckets = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayBuckets[key] = {
        date: key,
        label: d.toLocaleDateString("en-IN", { weekday: "short" }),
        leads: 0,
        conversions: 0,
      };
    }

    leads.forEach((lead) => {
      const created = new Date(lead.createdAt);
      const key = created.toISOString().slice(0, 10);
      if (dayBuckets[key]) {
        dayBuckets[key].leads++;
      }
      if (lead.isConverted && lead.convertedAt) {
        const c = new Date(lead.convertedAt);
        const cKey = c.toISOString().slice(0, 10);
        if (dayBuckets[cKey]) {
          dayBuckets[cKey].conversions++;
        }
      }
    });

    const trend7Days = Object.values(dayBuckets);

    // --- Proof-of-work metrics from EventLog ---
    const followupsSent = events.filter((e) => e.type === "followup_sent").length;
    const followupsScheduled = events.filter(
      (e) => e.type === "followup_scheduled"
    ).length;
    const whatsappIn = events.filter((e) => e.type === "whatsapp_in").length;
    const whatsappOutAI = events.filter(
      (e) => e.type === "whatsapp_out_ai"
    ).length;
    const stageChanges = events.filter((e) => e.type === "stage_changed").length;

    const metrics = {
      totalLeads,
      hotLeads,
      warmLeads,
      coldLeads,
      fakeLeads,
      convertedLeads,
      conversionRate,
      followupsSent,
      followupsScheduled,
      whatsappIn,
      whatsappOutAI,
      stageChanges,
    };

    res.json({
      ok: true,
      metrics,
      trend7Days,
      recentEvents: events,
    });
  } catch (err) {
    console.error("/api/analytics/summary error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
