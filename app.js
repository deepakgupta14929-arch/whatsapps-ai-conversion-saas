
// app.js (clean version)

require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcrypt");
const cors = require("cors");
const nodemailer = require("nodemailer");
const axios = require("axios");






// ====== ENV / CONSTANTS ======
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const verifyToken = process.env.VERIFY_TOKEN;

// ====== MODELS ======
const User = require("./models/user.model");
const Lead = require("./models/lead.model");
const Automation = require("./models/automation.model");
const FollowUpJob = require("./models/followUpJob.model");
const Agency = require("./models/agency.model");
const EventLog = require("./models/eventLog.model");



// ====== SERVICES ======
const {
  getAIReply,
  analyzeLead,
  generateHindiVoiceBuffer,
} = require("./services/ai.service");

const {
  sendWhatsAppText,
  uploadWhatsAppAudio,
  sendWhatsAppAudio,
} = require("./services/whatsapp.service");

const {
  scheduleFollowUpsForLead,
  autoAssignLead,
  findOrCreateLeadByPhone,
  processFollowUpJobs,
} = require("./services/followup.service");

const { logEvent } = require("./services/eventLog.service");
 const { normalizePhone } = require("./services/phone.util");

// ==== Routes =====
const coachRoutes = require("./routes/coach.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const leadsApiRoutes = require("./routes/leads.api.routes");
// ====== APP SETUP ======
const app = express();

// CORS for Next.js frontend
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// MongoDB
mongoose
  .connect("mongodb://127.0.0.1:27017/whatsapp_ai_saas")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// View engine & static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Body parsers
app.use(express.urlencoded({ extended: true })); // forms
app.use(express.json()); // JSON (webhook, APIs)
  // near your other route imports
const leadMessagesRoutes = require("./routes/leads.api.routes.js"); // or new filename
app.use("/api/leads", leadMessagesRoutes);

// ... then your sessions, auth, routes:
const visitRoutes = require("./routes/visit.routes");
app.use("/api/visits", visitRoutes);
// Sessions

app.use(
  session({
    secret: "change-this-secret-later", // TODO: move to env in prod
    resave: false,
    saveUninitialized: false,
  })
);
app.use(analyticsRoutes);
app.use(coachRoutes);
app.use(leadsApiRoutes);

// Email transporter
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ====== GLOBAL MIDDLEWARES ======

// Make current user + path available in all views
app.use(async (req, res, _next) => {
  res.locals.currentPath = req.path;
  res.locals.currentUser = null;

  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId).lean();
      res.locals.currentUser = user;
    } catch (e) {
      console.error(e);
    }
  }
  _next();
});

// Helper for using layout.ejs
function renderWithLayout(res, view, options = {}) {
  res.render("layout", { view, ...options });
}

// Auth guard
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.returnTo = req.originalUrl;
    return res.redirect("/login");
  }
  next();
}

// Force onboarding if not completed
app.use(async (req, res, next) => {
  if (!req.session.userId) return next();
  if (req.path.startsWith("/onboarding")) return next();

  try {
    const user = await User.findById(req.session.userId).lean();
    if (user && !user.onboardingCompleted) {
      return res.redirect("/onboarding");
    }
  } catch (e) {
    console.error("Onboarding check error:", e);
  }

  next();
});

// ====== BASIC PAGES ======

app.get("/", (req, res) => renderWithLayout(res, "home", { title: "Home" }));
app.get("/about", (req, res) =>
  renderWithLayout(res, "about", { title: "About" })
);
app.get("/services", (req, res) =>
  renderWithLayout(res, "services", { title: "Services" })
);
app.get("/pricing", (req, res) =>
  renderWithLayout(res, "pricing", { title: "Pricing" })
);
app.get("/faq", (req, res) => renderWithLayout(res, "faq", { title: "FAQ" }));

app.get("/contact", requireAuth, (req, res) =>
  renderWithLayout(res, "contact", { title: "Contact" })
);

// ====== CONTACT → CREATE LEAD + WHATSAPP + AI ======
app.post("/contact", requireAuth, async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !email || !phone) {
    return renderWithLayout(res, "contact", {
      title: "Contact",
      error: "Please fill all required fields.",
    });
  }

  try {
    const currentUser = await User.findById(req.session.userId);
     
        // 🔹 normalize phone for both DB + WhatsApp
    const normalizedPhone = normalizePhone(phone);
    console.log("Contact form phone:", phone, "-> normalized:", normalizedPhone);
     // 2) Save lead
    const newLead = await Lead.create({
      agencyId: currentUser.agencyId,
      userId: currentUser._id,
      name,
      email,
       phone: normalizedPhone,          // 👈 store normalized
      message,
      source: "Contact form",
      lastMessage: message,
      messages: [{ from: "lead", text: message }],
    });
    // Log lead created
      await logEvent({
  agencyId: currentUser.agencyId,
  userId: currentUser._id,
  leadId: newLead._id,
  type: "lead_created",
  meta: {
    source: "contact_form",
    //messageSnippet: message.slice(0, 120),
     messageSnippet: (message || "").slice(0, 120),
  },
});

    // schedule follow-ups
    await scheduleFollowUpsForLead(req.session.userId, newLead);

    // AI analyse lead (same logic you had)
    try {
      const analysis = await analyzeLead(message);
      if (analysis) {
        // score
        if (typeof analysis.score === "number") {
          newLead.score = analysis.score;
        } else if (typeof analysis.score === "string") {
          const parsed = parseInt(analysis.score, 10);
          if (!Number.isNaN(parsed)) newLead.score = parsed;
        }

        newLead.qualificationLevel =
          analysis.qualificationLevel || newLead.qualificationLevel;
        newLead.budget = analysis.budget || newLead.budget;
        newLead.timeline = analysis.timeline || newLead.timeline;
        newLead.useCase = analysis.useCase || newLead.useCase;

        newLead.aiIntent = analysis.aiIntent || newLead.aiIntent;
        newLead.aiUrgency = analysis.aiUrgency || newLead.aiUrgency;
        newLead.aiNotes = analysis.aiNotes || newLead.aiNotes;

        if (typeof analysis.willRespondScore === "number") {
          newLead.willRespondScore = analysis.willRespondScore;
        }
        if (typeof analysis.willBuyScore === "number") {
          newLead.willBuyScore = analysis.willBuyScore;
        }
        if (analysis.priorityLevel) {
          newLead.priorityLevel = analysis.priorityLevel;
        }
        if (analysis.engagementNotes) {
          newLead.engagementNotes = analysis.engagementNotes;
        }

        if (typeof analysis.isFake === "boolean") {
          newLead.isFake = analysis.isFake;
        }
        if (analysis.fakeReason) {
          newLead.fakeReason = analysis.fakeReason;
        }

        if (newLead.isFake && newLead.stage !== "closed") {
          newLead.stage = "lost";
        }
        await logEvent({
  agencyId: currentUser.agencyId,
  userId: currentUser._id,
  leadId: newLead._id,
  type: "lead_updated",
  meta: {
    notes: "Marked as fake by AI",
    fakeReason: newLead.fakeReason,
  },
});
   
    if (newLead.isFake && newLead.stage === "lost") {
  await logEvent({
    agencyId: currentUser.agencyId,
    userId: currentUser._id,
    leadId: newLead._id,
    type: "lead_updated",
    meta: { notes: "Marked as fake by AI", fakeReason: newLead.fakeReason },
  });
}


        console.log("Contact AI mapped:", {
          level: newLead.qualificationLevel,
          urgency: newLead.aiUrgency,
          intent: newLead.aiIntent,
          score: newLead.score,
        });

        await newLead.save();
      }
    } catch (e) {
      console.error("Contact form AI analyze error:", e);
    }

    // Auto-assign
    await autoAssignLead(newLead, currentUser);

    // Send WhatsApp welcome
    const text =
      `Hi ${name || ""}! 👋 Thanks for reaching out.\n\n` +
      `We've received your details and will get back to you shortly.\n\n` +
      `- WhatsFlow AI`;

    let result = { ok: false };
    if (currentUser) {
      const TEST_RECEIVER = normalizedPhone  || "916367254181";
      result = await sendWhatsAppText(currentUser, TEST_RECEIVER, text);
    }

    if (result.ok) {
      newLead.stage = "contacted";
      await newLead.save();
    }

    return renderWithLayout(res, "contact", {
      title: "Contact",
      success:
        "Thanks! We received your message. We'll contact you on WhatsApp.",
      error: null,
    });
  } catch (err) {
    console.error("Error saving lead:", err);
    return renderWithLayout(res, "contact", {
      title: "Contact",
      error: "Something went wrong. Please try again.",
      success: null,
    });
  }
});

// ====== AUTH ======

app.get("/signup", (req, res) =>
  renderWithLayout(res, "signup", { title: "Sign up", error: null })
);

app.post("/signup", async (req, res) => {
  const { name, email, password, businessType } = req.body;

  if (!name || !email || !password) {
    return renderWithLayout(res, "signup", {
      title: "Sign up",
      error: "Please fill all required fields.",
    });
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return renderWithLayout(res, "signup", {
        title: "Sign up",
        error: "Email is already registered.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      passwordHash,
      businessType,
      role: "owner",
    });

    const agency = await Agency.create({
      name: `${name}'s Agency`,
      ownerUserId: user._id,
    });

    user.agencyId = agency._id;
    await user.save();

    req.session.userId = user._id;
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    return renderWithLayout(res, "signup", {
      title: "Sign up",
      error: "Something went wrong. Try again.",
    });
  }
});

app.get("/login", (req, res) =>
  renderWithLayout(res, "login", { title: "Login", error: null })
);

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return renderWithLayout(res, "login", {
      title: "Login",
      error: "Invalid email or password.",
    });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return renderWithLayout(res, "login", {
      title: "Login",
      error: "Invalid email or password.",
    });
  }

  req.session.userId = user._id;

  const redirectTo = req.session.returnTo || "/dashboard";
  delete req.session.returnTo;

  res.redirect(redirectTo);
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ====== ONBOARDING ======

app.get("/onboarding", requireAuth, async (req, res) => {
  const user = await User.findById(req.session.userId).lean();

  return renderWithLayout(res, "onboarding", {
    title: "Onboarding",
    user,
  });
});

app.post("/onboarding", requireAuth, async (req, res) => {
  const {
    brandName,
    websiteUrl,
    targetCountry,
    primaryOffer,
    whatsappGreeting,
    aiTone,
    aiNotes,
  } = req.body;

  await User.findByIdAndUpdate(req.session.userId, {
    brandName,
    websiteUrl,
    targetCountry,
    primaryOffer,
    whatsappGreeting,
    aiTone,
    aiNotes,
    onboardingCompleted: true,
  });

  res.redirect("/dashboard");
});

// ====== DASHBOARD ======

app.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    const leads = await Lead.find({ agencyId: currentUser.agencyId }).lean();

    const totalLeads = leads.length;
    const hotLeads = leads.filter((l) => l.qualificationLevel === "hot").length;
    const warmLeads = leads.filter((l) => l.qualificationLevel === "warm").length;
    const coldLeads = leads.filter((l) => l.qualificationLevel === "cold").length;

    const convertedLeads = leads.filter((l) => l.isConverted).length;
    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    let totalMessages = 0;
    let botMessages = 0;
    let leadMessages = 0;

    leads.forEach((lead) => {
      if (!lead.messages) return;
      totalMessages += lead.messages.length;
      lead.messages.forEach((msg) => {
        if (msg.from === "bot" || msg.from === "agent") botMessages++;
        if (msg.from === "lead") leadMessages++;
      });
    });

    const now = new Date();
    const last7Days = [];
    const conv7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString("en-IN", { weekday: "short" });

      last7Days.push({ date: key, label, value: 0 });
      conv7Days.push({ date: key, label, value: 0 });
    }

    const dayIndexMap = {};
    last7Days.forEach((d, idx) => (dayIndexMap[d.date] = idx));

    leads.forEach((lead) => {
      const created = new Date(lead.createdAt);
      const key = created.toISOString().slice(0, 10);
      if (dayIndexMap[key] !== undefined) last7Days[dayIndexMap[key]].value++;
    });

    leads.forEach((lead) => {
      if (!lead.isConverted || !lead.convertedAt) return;
      const c = new Date(lead.convertedAt);
      const key = c.toISOString().slice(0, 10);
      if (dayIndexMap[key] !== undefined) conv7Days[dayIndexMap[key]].value++;
    });

    const sourceCounts = {};
    leads.forEach((lead) => {
      const key = lead.source || "Unknown";
      sourceCounts[key] = (sourceCounts[key] || 0) + 1;
    });

    const sourceBreakdown = Object.entries(sourceCounts).map(
      ([label, count]) => ({ label, count })
    );

    const metrics = {
      totalLeads,
      hotLeads,
      warmLeads,
      coldLeads,
      convertedLeads,
      conversionRate,
      totalMessages,
      botMessages,
      leadMessages,
      last7Days,
      conversionTrend7Days: conv7Days,
      sourceBreakdown,
    };

    renderWithLayout(res, "dashboard", {
      title: "Dashboard",
      metrics,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    renderWithLayout(res, "dashboard", {
      title: "Dashboard",
      metrics: null,
      error: "Failed to load analytics",
    });
  }
});

// ====== INBOX & LEADS PAGES ======

app.get("/inbox", requireAuth, async (req, res) => {
  try {
    const leads = await Lead.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .lean();

    renderWithLayout(res, "inbox", {
      title: "Inbox",
      leads,
      activeLead: null,
      messages: [],
    });
  } catch (err) {
    console.error("Inbox error:", err);
    res.status(500).send("Inbox error");
  }
});

app.get("/inbox/:id", requireAuth, async (req, res) => {
  try {
    const leads = await Lead.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .lean();

    const activeLead = await Lead.findOne({
      _id: req.params.id,
      userId: req.session.userId,
    }).lean();

    renderWithLayout(res, "inbox", {
      title: "Inbox",
      leads,
      activeLead,
      messages: activeLead?.messages || [],
    });
  } catch (err) {
    console.error("Inbox lead error:", err);
    res.redirect("/inbox");
  }
});

app.get("/leads", requireAuth, async (req, res) => {
  const leads = await Lead.find({ userId: req.session.userId })
    .sort({ createdAt: -1 })
    .lean();

  renderWithLayout(res, "leads", { title: "Leads", leads });
});

app.get("/leads/:id", requireAuth, async (req, res) => {
  try {
    const lead = await Lead.findOne({
      _id: req.params.id,
      userId: req.session.userId,
    }).lean();

    if (!lead) return res.status(404).send("Lead not found");

    renderWithLayout(res, "lead-detail", {
      title: "Conversation",
      lead,
    });
  } catch (err) {
    console.error("Error loading lead detail:", err);
    res.status(500).send("Server error");
  }
});

app.post("/leads/:id/reply", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).send("User not found / not logged in");

    const lead = await Lead.findOne({
      _id: req.params.id,
      userId: req.session.userId,
    });

    if (!lead) return res.status(404).send("Lead not found");
    if (!lead.phone)
      return res
        .status(400)
        .send("This lead has no phone number to send WhatsApp messages");

    const text = (req.body.message || "").trim();
    if (!text) return res.redirect(`/leads/${lead._id}`);

    const waResult = await sendWhatsAppText(user, lead.phone, text);
    console.log("Manual reply WA result:", waResult);

    if (lead.stage === "new") lead.stage = "contacted";

    lead.messages.push({
      from: "bot", // or "agent"
      text,
      at: new Date(),
    });
    lead.lastMessage = text;
    await lead.save();

    res.redirect(`/leads/${lead._id}`);
  } catch (err) {
    console.error("Error sending manual reply:", err);
    res.status(500).send("Error sending reply, check server logs.");
  }
});

app.post("/leads/:id/convert", requireAuth, async (req, res) => {
  try {
    const lead = await Lead.findOne({
      _id: req.params.id,
      userId: req.session.userId,
    });

    if (!lead) return res.status(404).send("Lead not found");

    lead.isConverted = true;
    lead.convertedAt = new Date();
    lead.stage = "closed";

    await lead.save();
    await logEvent({
  agencyId: lead.agencyId,
  userId: req.session.userId,
  leadId: lead._id,
  type: "lead_converted",
});

    res.redirect(`/leads/${lead._id}`);
  } catch (err) {
    console.error("Error marking as converted:", err);
    res.status(500).send("Error updating lead");
  }
});

app.post("/leads/:id/lost", requireAuth, async (req, res) => {
  try {
    const lead = await Lead.findOne({
      _id: req.params.id,
      userId: req.session.userId,
    });

    if (!lead) return res.status(404).send("Lead not found");

    lead.isConverted = false;
    lead.convertedAt = null;
    lead.stage = "lost";

    await lead.save();
    await logEvent({
  agencyId: lead.agencyId,
  userId: req.session.userId,
  leadId: lead._id,
  type: "lead_lost",
});

    res.redirect(`/leads/${lead._id}`);
  } catch (err) {
    console.error("Error marking as lost:", err);
    res.status(500).send("Error updating lead");
  }
});

app.post("/leads/:id/assign-self", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId);
    if (!currentUser) {
      return res.status(401).send("User not found / not logged in");
    }

    const lead = await Lead.findOne({
      _id: req.params.id,
      agencyId: currentUser.agencyId,
    });

    if (!lead) return res.status(404).send("Lead not found for this agency");

    lead.assignedTo = currentUser._id;
    await lead.save();
    await logEvent({
  agencyId: currentUser.agencyId,
  userId: currentUser._id,
  leadId: lead._id,
  type: "lead_assigned",
  meta: {
    notes: "Assigned to self",
  },
});

    console.log("✅ Lead assigned to user:", lead._id.toString(), "→", currentUser.email);
      
    res.redirect(`/leads/${lead._id}`);
  } catch (err) {
    console.error("Error assigning lead to self:", err);
    res.status(500).send("Server error while assigning lead");
  }
});

// ====== API: LEADS & AGENT STATS ======

app.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser || !currentUser.agencyId) {
      return res.status(401).json({ error: "User/agency not found" });
    }

    const query = { agencyId: currentUser.agencyId };

    if (req.query.assignedOnly === "true") {
      query.assignedTo = currentUser._id;
    }

    const leads = await Lead.find(query)
      .sort({ createdAt: -1 })
      .select(
        "name phone lastMessage stage " +
          "qualificationLevel score aiIntent aiUrgency " +
          "budget timeline useCase aiNotes " +
          "isFake fakeReason " +
          "willRespondScore willBuyScore priorityLevel engagementNotes"
      )
      .lean();

    res.json({ leads });
  } catch (err) {
    console.error("/api/leads error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// Get full conversation for one lead (JSON)
app.get("/api/leads/:id/messages", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser || !currentUser.agencyId) {
      return res.status(401).json({ error: "User/agency not found" });
    }

    const lead = await Lead.findOne({
      _id: req.params.id,
      agencyId: currentUser.agencyId, // make sure it belongs to this agency
    })
      .select("name phone messages createdAt")
      .lean();

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const messages = (lead.messages || []).sort((a, b) => {
      const ta = new Date(a.at || a.createdAt || lead.createdAt).getTime();
      const tb = new Date(b.at || b.createdAt || lead.createdAt).getTime();
      return ta - tb;
    });

    return res.json({
      leadId: lead._id,
      name: lead.name,
      phone: lead.phone,
      messages,
    });
  } catch (err) {
    console.error("/api/leads/:id/messages error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


app.get("/api/agents/stats", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser) {
      return res.status(401).json({ error: "User not found" });
    }

    if (!currentUser.agencyId) {
      return res.json({ agents: [] });
    }

    const agencyId = currentUser.agencyId;

    const agents = await User.find({
      agencyId,
      role: { $in: ["owner", "admin", "agent"] },
      isActive: { $ne: false },
    })
      .select("_id name email role")
      .lean();

    if (!agents.length) return res.json({ agents: [] });

    const leads = await Lead.find({ agencyId })
      .select("assignedTo qualificationLevel isConverted")
      .lean();

    const statsById = {};
    for (const a of agents) {
      const id = String(a._id);
      statsById[id] = {
        agentId: id,
        name: a.name || "Unnamed",
        email: a.email,
        role: a.role,
        totalLeads: 0,
        hotLeads: 0,
        closedLeads: 0,
        conversionRate: 0,
      };
    }

    for (const lead of leads) {
      if (!lead.assignedTo) continue;
      const id = String(lead.assignedTo);
      const entry = statsById[id];
      if (!entry) continue;

      entry.totalLeads += 1;
      if (lead.qualificationLevel === "hot") entry.hotLeads += 1;
      if (lead.isConverted) entry.closedLeads += 1;
    }

    const result = Object.values(statsById).map((entry) => {
      if (entry.totalLeads > 0) {
        entry.conversionRate = Math.round(
          (entry.closedLeads / entry.totalLeads) * 100
        );
      } else {
        entry.conversionRate = 0;
      }
      return entry;
    });

    return res.json({ agents: result });
  } catch (err) {
    console.error("Agent stats error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});
// ====== AGENCY ANALYTICS SUMMARY API ======


// ====== PIPELINE (KANBAN) ======

const PIPELINE_STAGES = ["new", "contacted", "qualified", "hot", "closed", "lost"];

app.get("/pipeline", requireAuth, async (req, res) => {
  try {
    const leads = await Lead.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .lean();

    const columns = {};
    PIPELINE_STAGES.forEach((stage) => {
      columns[stage] = [];
    });

    leads.forEach((lead) => {
      const stage = PIPELINE_STAGES.includes(lead.stage) ? lead.stage : "new";
      columns[stage].push(lead);
    });

    renderWithLayout(res, "pipeline", {
      title: "Pipeline",
      columns,
      stages: PIPELINE_STAGES,
    });
  } catch (err) {
    console.error("Pipeline error:", err);
    renderWithLayout(res, "pipeline", {
      title: "Pipeline",
      columns: {},
      stages: PIPELINE_STAGES,
    });
  }
});

app.post("/pipeline/move", requireAuth, async (req, res) => {
  try {
    const { leadId, stage } = req.body;
    console.log("📨 /pipeline/move called:", {
      leadId,
      stage,
      userId: req.session.userId,
    });

    if (!leadId || !PIPELINE_STAGES.includes(stage)) {
      return res.status(400).json({ ok: false, error: "Invalid data" });
    }

    const lead = await Lead.findOne({
      _id: leadId,
      userId: req.session.userId,
    });

    if (!lead) {
      return res.status(404).json({ ok: false, error: "Lead not found" });
    }

    lead.stage = stage;

    if (stage === "hot") lead.qualificationLevel = "hot";
    if (stage === "closed") {
      lead.isConverted = true;
      lead.convertedAt = new Date();
    }

    await lead.save();
    console.log("✅ Lead stage updated:", lead._id.toString(), "→", lead.stage);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Pipeline move error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Server error while moving lead" });
  }
});

// ====== SETTINGS PAGES ======

app.get("/settings", requireAuth, async (req, res) => {
  try {
    let automation = await Automation.findOne({
      userId: req.session.userId,
    }).lean();

    if (!automation) {
      automation = { enabled: false, followUps: [] };
    }

    renderWithLayout(res, "settings", {
      title: "Settings",
      automation,
    });
  } catch (err) {
    console.error("Settings load error:", err);
    renderWithLayout(res, "settings", {
      title: "Settings",
      automation: { enabled: false, followUps: [] },
    });
  }
});

app.post("/settings/whatsapp", requireAuth, async (req, res) => {
  const { whatsappAccessToken, phoneNumberId } = req.body;

  await User.findByIdAndUpdate(req.session.userId, {
    whatsappAccessToken,
    phoneNumberId,
    whatsappConnected: true,
  });

  res.redirect("/settings");
});

app.post("/settings/automation", requireAuth, async (req, res) => {
  const { enabled, delayHours, message, channel } = req.body;

  await Automation.updateOne(
    { userId: req.session.userId },
    {
      userId: req.session.userId,
      enabled: !!enabled,
      followUps: [
        {
          delayHours: Number(delayHours),
          message,
          channel,
        },
      ],
    },
    { upsert: true }
  );

  res.redirect("/settings");
});



// Simple report for last 30 days
app.get("/reports", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser || !currentUser.agencyId) {
      return res.status(401).send("Agency not found");
    }

    const agencyId = currentUser.agencyId;
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [leads, events] = await Promise.all([
      Lead.find({ agencyId, createdAt: { $gte: since } }).lean(),
      EventLog.find({ agencyId, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const totalLeads = leads.length;
    const convertedLeads = leads.filter((l) => l.isConverted).length;
    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    const followupsSent = events.filter((e) => e.type === "followup_sent").length;
    const aiReplies = events.filter((e) => e.type === "whatsapp_out_ai").length;
    const inboundMessages = events.filter((e) => e.type === "whatsapp_in").length;

    // Group events by day for chart
    const daily = {};
    events.forEach((e) => {
      const d = new Date(e.createdAt);
      const key = d.toISOString().slice(0, 10);
      if (!daily[key]) {
        daily[key] = { date: key, leads: 0, messagesIn: 0, messagesOut: 0 };
      }
      if (e.type === "lead_created") daily[key].leads++;
      if (e.type === "whatsapp_in") daily[key].messagesIn++;
      if (e.type === "whatsapp_out_ai" || e.type === "whatsapp_out_agent")
        daily[key].messagesOut++;
    });

    const dailySeries = Object.values(daily).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    renderWithLayout(res, "reports", {
      title: "Agency Reports",
      summary: {
        totalLeads,
        convertedLeads,
        conversionRate,
        followupsSent,
        aiReplies,
        inboundMessages,
      },
      dailySeries,
      recentEvents: events.slice(0, 100), // show latest 100 actions
    });
  } catch (err) {
    console.error("Reports error:", err);
    res.status(500).send("Failed to load reports");
  }
});


// ====== EMAIL HELPER ======
// eslint-disable-next-line no-unused-vars
async function sendEmail(to, subject, text) {
  try {
    if (!to) {
      console.error("sendEmail: missing 'to' address");
      return { ok: false, error: "No recipient" };
    }

    const fromEmail = process.env.FROM_EMAIL;
    const fromName = process.env.FROM_NAME || "WhatsFlow AI";

    const info = await emailTransporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to,
      subject,
      text,
    });

    console.log("Email sent:", info.messageId);
    return { ok: true, data: info };
  } catch (err) {
    console.error("Email send error:", err);
    return { ok: false, error: err.message };
  }
}

// ====== DEBUG ROUTES ======

app.get("/debug/automation", requireAuth, async (req, res) => {
  const auto = await Automation.findOne({ userId: req.session.userId }).lean();
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(auto, null, 2));
});

app.get("/debug-leads", async (req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 }).lean();
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(leads, null, 2));
  } catch (err) {
    console.error("Error fetching leads:", err);
    res.status(500).send("Error fetching leads");
  }
});

app.get("/debug/clear-followups", requireAuth, async (req, res) => {
  await FollowUpJob.deleteMany({ userId: req.session.userId });
  await Automation.updateOne(
    { userId: req.session.userId },
    { followUps: [] }
  );
  res.send("Cleared follow-ups and automation rules for this user.");
});

app.get("/debug/followups", requireAuth, async (req, res) => {
  const jobs = await FollowUpJob.find({ userId: req.session.userId })
    .sort({ runAt: 1 })
    .lean();

  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(jobs, null, 2));
});



app.get("/debug/events", requireAuth, async (req, res) => {
  try {
    const currentUser = await User.findById(req.session.userId).lean();
    if (!currentUser || !currentUser.agencyId) {
      return res.status(401).send("No agency / user");
    }

    const events = await EventLog.find({ agencyId: currentUser.agencyId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(events, null, 2));
  } catch (err) {
    console.error("debug/events error:", err);
    res.status(500).send("Error loading events");
  }
});
app.get("/debug-events", requireAuth, async (req, res) => {
  const events = await require("./models/event.model").find({ agencyId: req.session && req.session.agencyId ? req.session.agencyId : undefined })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.setHeader("Content-Type","application/json");
  res.send(JSON.stringify(events, null, 2));
});
app.get("/debug-events-all", async (req, res) => {
  const events = await require("./models/event.model").find().sort({ createdAt: -1 }).limit(200).lean();
  res.json({ events });
});



// ====== WHATSAPP TEST ROUTES ======

app.get("/settings/test-whatsapp", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    if (
      !user.whatsappConnected ||
      !user.phoneNumberId ||
      !user.whatsappAccessToken
    ) {
      return res.send(
        "⚠️ WhatsApp is not connected in settings. Add your API Token + Phone Number ID."
      );
    }

    const TEST_RECEIVER = "916367254181";

    const result = await sendWhatsAppText(
      user,
      TEST_RECEIVER,
      "🚀 WhatsFlow AI test message — connection success!"
    );

    if (result.ok) {
      return res.send("🎉 Message sent! Check your WhatsApp.");
    } else {
      return res.send("❌ Failed: " + JSON.stringify(result.error));
    }
  } catch (err) {
    console.error("Test error:", err);
    return res.send("Server error — check logs.");
  }
});

app.get("/test-whatsapp-template", async (req, res) => {
  const TEST_RECEIVER = "916367254181";

  try {
    const url = `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: TEST_RECEIVER,
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" },
      },
    };

    const headers = {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    };

    const response = await axios.post(url, payload, { headers });
    console.log("Template response:", response.data);
    res.send("Template message sent. Check your WhatsApp.");
  } catch (err) {
    console.error("Template error:", err.response?.data || err.message);
    res
      .status(500)
      .send("Error: " + JSON.stringify(err.response?.data || err.message));
  }
});

// ====== WHATSAPP WEBHOOKS ======

// Incoming messages + AI auto reply
app.post("/webhook", express.json(), async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));
   
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messageObj = value?.messages?.[0];

      if (!entry) {
      console.log("Webhook: no entry");
      return res.sendStatus(200);
    }
    // Ignore status-only callbacks (sent/delivered/read)
    if (!messageObj) {
      return res.sendStatus(200);
    }

    const metadata = value?.metadata;
    const phoneNumberId = metadata?.phone_number_id;
    if (!phoneNumberId) {
      console.error("No phone_number_id in metadata");
      return res.sendStatus(200);
    }

    const user = await User.findOne({ phoneNumberId });
    if (!user) {
      console.error("No user found for phone_number_id:", phoneNumberId);
      return res.sendStatus(200);
    }

    const from = messageObj.from;
    const text = messageObj.text?.body || "";

    console.log(
      "Incoming message from:",
      from,
      "text:",
      text,
      "for user:",
      user.email
    );

    if (!text) {
      return res.sendStatus(200);
    }

    // 1️⃣ Create / find lead FIRST
    const lead = await findOrCreateLeadByPhone(user, from, text);

    // 2️⃣ Now we can safely log inbound WhatsApp
    await logEvent({
      agencyId: user.agencyId,
      userId: user._id,
      leadId: lead._id,
      type: "whatsapp_in",
      meta: {
        direction: "in",
        messageSnippet: (text || "").slice(0, 120),
      },
    });

    // 3️⃣ Analyze lead with AI
    const analysis = await analyzeLead(text);
    if (analysis) {
      const oldStage = lead.stage; // for stage_changed log

      lead.qualificationLevel =
        analysis.qualificationLevel || lead.qualificationLevel;
      lead.budget = analysis.budget || lead.budget;
      lead.timeline = analysis.timeline || lead.timeline;
      lead.useCase = analysis.useCase || lead.useCase;

      lead.aiIntent = analysis.aiIntent || lead.aiIntent;
      lead.aiUrgency = analysis.aiUrgency || lead.aiUrgency;
      lead.aiNotes = analysis.aiNotes || lead.aiNotes;

      if (typeof analysis.willRespondScore === "number") {
        lead.willRespondScore = analysis.willRespondScore;
      }
      if (typeof analysis.willBuyScore === "number") {
        lead.willBuyScore = analysis.willBuyScore;
      }
      if (analysis.priorityLevel) {
        lead.priorityLevel = analysis.priorityLevel;
      }
      if (analysis.engagementNotes) {
        lead.engagementNotes = analysis.engagementNotes;
      }

      if (typeof analysis.score === "number") {
        lead.score = analysis.score;
      } else if (typeof analysis.score === "string") {
        const parsed = parseInt(analysis.score, 10);
        if (!Number.isNaN(parsed)) lead.score = parsed;
      }

      if (Array.isArray(analysis.aiTags)) {
        lead.aiTags = analysis.aiTags;
      }

      if (typeof analysis.isFake === "boolean") {
        lead.isFake = analysis.isFake;
      }
      if (analysis.fakeReason) {
        lead.fakeReason = analysis.fakeReason;
      }

      // Stage rules
      if (
        analysis.qualificationLevel === "hot" &&
        lead.stage !== "closed" &&
        lead.stage !== "lost"
      ) {
        lead.stage = "hot";
      } else if (
        analysis.qualificationLevel === "warm" &&
        lead.stage === "new"
      ) {
        lead.stage = "qualified";
      }

      if (lead.isFake && lead.stage !== "closed") {
        lead.stage = "lost";
      }

      // Log stage change if changed
      if (lead.stage !== oldStage) {
        await logEvent({
          agencyId: user.agencyId,
          userId: user._id,
          leadId: lead._id,
          type: "stage_changed",
          meta: {
            fromStage: oldStage,
            toStage: lead.stage,
          },
        });
      }

      await lead.save();

      console.log("Updated lead with AI data:", {
        level: lead.qualificationLevel,
        score: lead.score,
        intent: lead.aiIntent,
        urgency: lead.aiUrgency,
        isFake: lead.isFake,
        fakeReason: lead.fakeReason,
      });
    }

    // 4️⃣ AI reply
    const aiReply = await getAIReply(text);
    console.log("AI reply:", aiReply);

    const waResult = await sendWhatsAppText(user, from, aiReply);
    console.log("WhatsApp send result:", waResult);

    // Log outbound AI message
    await logEvent({
      agencyId: user.agencyId,
      userId: user._id,
      leadId: lead._id,
      type: "whatsapp_out_ai",
      meta: {
        direction: "out",
        messageSnippet: (aiReply || "").slice(0, 120),waResult
      },
    });

    // 5️⃣ Optional: voice note for hot leads
    try {
      const isHot =
        lead.qualificationLevel === "hot" || lead.aiUrgency === "high";

      if (isHot) {
        console.log("🔥 Generating Hindi voice note for lead", lead._id.toString());

        const audioBuffer = await generateHindiVoiceBuffer(aiReply);
        if (audioBuffer) {
          const mediaId = await uploadWhatsAppAudio(user, audioBuffer);
          if (mediaId) {
            const voiceResult = await sendWhatsAppAudio(user, from, mediaId);
            console.log("Voice note send result:", voiceResult);
          } else {
            console.error("Failed to upload voice audio to WhatsApp");
          }
        } else {
          console.error("Failed to generate TTS audio");
        }
      }
    } catch (err) {
      console.error("Voice note pipeline error:", err);
    }

    // 6️⃣ Update stage + messages
    if (lead.stage === "new") {
      lead.stage = "contacted";
    }

    lead.messages.push({
      from: "bot",
      text: aiReply,
    });
    await lead.save();

    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.sendStatus(200);
  }
});


// Webhook verification GET
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    console.log("Webhook Verified");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  if (req.xhr || req.path.startsWith("/api/")) {
    return res.status(500).json({ ok: false, error: "Server error" });
  }
  res.status(500).send("Something went wrong. Please try again.");
});

// ====== FOLLOW-UP CRON ======

setInterval(processFollowUpJobs, 5 * 60 * 1000); // every 5 minutes

// ====== START SERVER ======
const PORT = 1400;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
