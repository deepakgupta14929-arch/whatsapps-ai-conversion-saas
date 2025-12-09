// services/followup.service.js

const Automation = require("../models/automation.model");
const FollowUpJob = require("../models/followUpJob.model");
const Lead = require("../models/lead.model");
const User = require("../models/user.model");
const Agency = require("../models/agency.model");
const { sendWhatsAppText } = require("./whatsapp.service");
const { logEvent } = require("./eventLog.service");
const { normalizePhone } = require("./phone.util");

// Schedule follow-ups based on user's Automation rules
async function scheduleFollowUpsForLead(userId, lead) {
  try {
    const automation = await Automation.findOne({ userId }).lean();
    if (!automation || !automation.enabled || !automation.followUps?.length) {
      return;
    }

    const now = new Date();

    const jobs = automation.followUps.map((rule) => ({
      userId,
      leadId: lead._id,
      channel: rule.channel,
      message: rule.message,
      runAt: new Date(now.getTime() + rule.delayHours * 60 * 60 * 1000),
      sent: false,
    }));

    if (jobs.length) {
      await FollowUpJob.insertMany(jobs);
      console.log(`Scheduled ${jobs.length} follow-up jobs for lead ${lead._id}`);

      // 🔹 Log each follow-up rule scheduled
      for (const rule of automation.followUps) {
        await logEvent({
          agencyId: lead.agencyId,
          userId,
          leadId: lead._id,
          type: "followup_scheduled",
          meta: {
            channel: rule.channel,
            notes: `delayHours=${rule.delayHours}`,
          },
        });
      }
    }
  } catch (err) {
    console.error("scheduleFollowUpsForLead error:", err);
  }
}

// Auto-assign lead to least recently assigned agent
async function autoAssignLead(lead, currentUser) {
  try {
    if (!currentUser || !currentUser.agencyId) return;

    const agents = await User.find({
      agencyId: currentUser.agencyId,
      isActive: true,
      role: { $in: ["owner", "agent"] },
    }).sort({ lastAssignedAt: 1 });

    if (!agents.length) return;

    const chosen = agents[0];

    lead.assignedTo = chosen._id;
    await lead.save();

    chosen.lastAssignedAt = new Date();
    await chosen.save();

    console.log(
      `autoAssignLead: lead ${lead._id.toString()} assigned to ${chosen.email}`
    );
  } catch (err) {
    console.error("autoAssignLead error:", err);
  }
}

// Create or update lead when WhatsApp message comes in
// async function findOrCreateLeadByPhone(user, phone, lastMessage) {
//     const normalizedPhone = normalizePhone(phone);

//   if (!user.agencyId) {
//     let agency = await Agency.findOne({ ownerUserId: user._id });

//     if (!agency) {
//       agency = await Agency.create({
//         name: `${user.name}'s Agency`,
//         ownerUserId: user._id,
//       });
//     }

//     user.agencyId = agency._id;
//     await user.save();
//   }

//   let lead = await Lead.findOne({ agencyId: user.agencyId, phone: normalizedPhone, });

//   if (!lead) {
//     lead = await Lead.create({
//       agencyId: user.agencyId,
//       userId: user._id,
//        phone: normalizedPhone,
//       source: "WhatsApp inbound",
//       lastMessage,
//       messages: [
//         {
//           from: "lead",
//           text: lastMessage,
//         },
//       ],
//     });

//     await scheduleFollowUpsForLead(user._id, lead);
//     await autoAssignLead(lead, user);
//   } else {
//     lead.lastMessage = lastMessage;
//     lead.messages.push({
//       from: "lead",
//       text: lastMessage,
//     });
//     await lead.save();
//   }

//   return lead;
// }
async function findOrCreateLeadByPhone(user, phone, lastMessage) {
  const normalizedPhone = normalizePhone(phone);

  // ✅ ALWAYS re-use the latest lead for this phone
  let lead = await Lead.findOne({ phone: normalizedPhone })
    .sort({ createdAt: -1 });

  // If no lead exists yet (WhatsApp-first lead), create one
  if (!lead) {
    // Make sure user has an agency
    if (!user.agencyId) {
      let agency = await Agency.findOne({ ownerUserId: user._id });

      if (!agency) {
        agency = await Agency.create({
          name: `${user.name}'s Agency`,
          ownerUserId: user._id,
        });
      }

      user.agencyId = agency._id;
      await user.save();
    }

    lead = await Lead.create({
      agencyId: user.agencyId,
      userId: user._id,
      phone: normalizedPhone,
      source: "WhatsApp inbound",
      lastMessage,
      messages: [
        {
          from: "lead",
          text: lastMessage,
        },
      ],
    });

    // keep your existing hooks
    await scheduleFollowUpsForLead(user._id, lead);
    await autoAssignLead(lead, user);
  } else {
    // 🔁 Contact-form lead (or an older WA lead) already exists
    lead.lastMessage = lastMessage;
    lead.messages.push({
      from: "lead",
      text: lastMessage,
    });
    await lead.save();
  }

  console.log("findOrCreateLeadByPhone → using lead", {
    id: String(lead._id),
    phone: lead.phone,
    source: lead.source,
    messagesCount: lead.messages?.length,
  });

  return lead;
}

// Process pending follow-up jobs
async function processFollowUpJobs() {
  const now = new Date();

  try {
    console.log("▶ processFollowUpJobs tick at", now.toISOString());

    const jobs = await FollowUpJob.find({
      sent: false,
      runAt: { $lte: now },
    }).limit(50);

    console.log("Pending jobs to process:", jobs.length);
    if (!jobs.length) return;

    for (const job of jobs) {
      console.log(
        "Handling job",
        job._id.toString(),
        "channel:",
        job.channel,
        "runAt:",
        job.runAt.toISOString()
      );

      const user = await User.findById(job.userId);
      const lead = await Lead.findById(job.leadId);

      if (!user || !lead) {
        console.log("Skipping job (missing user or lead)", job._id.toString());
        job.sent = true;
        job.sentAt = new Date();
        await job.save();
        continue;
      }

      if (job.channel === "whatsapp") {
        if (!lead.phone) {
          console.log("Skipping WA job (lead has no phone)", job._id.toString());
        } else {
          const result = await sendWhatsAppText(user, lead.phone, job.message);
          console.log("Follow-up WA result:", result);

          // 🔹 Log follow-up sent
          await logEvent({
            agencyId: lead.agencyId,
            userId: user._id,
            leadId: lead._id,
            type: "followup_sent",
            meta: {
              channel: job.channel,
              messageSnippet: job.message.slice(0, 120),
            },
          });

          // Save message in conversation
          lead.messages.push({
            from: "bot",
            text: job.message,
            at: new Date(),
          });
          lead.lastMessage = job.message;
          await lead.save();
        }
      } else if (job.channel === "email") {
        console.log(
          "Skipping email follow-up (email not configured) for job",
          job._id.toString()
        );
        // here you can call sendEmail in future
      }

      job.sent = true;
      job.sentAt = new Date();
      await job.save();
    }
  } catch (err) {
    console.error("Error in processFollowUpJobs:", err);
  }
}

module.exports = {
  scheduleFollowUpsForLead,
  autoAssignLead,
  findOrCreateLeadByPhone,
  processFollowUpJobs,
};
