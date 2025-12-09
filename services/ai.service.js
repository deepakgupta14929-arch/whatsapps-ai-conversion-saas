// services/ai.service.js
const axios = require("axios");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function getAIReply(userMessage) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are WhatsFlow AI, a WhatsApp sales assistant for INDIAN REAL ESTATE.\n" +
              "Target audience: middle-class and upper-middle-class buyers/tenants in cities like Jaipur.\n" +
              "Language: Hinglish (mix of simple Hindi + English), very clear and respectful.\n\n" +
              "YOU MUST ADAPT TONE DYNAMICALLY BASED ON THE MESSAGE:\n" +
              "- If the lead looks VERY SERIOUS (clear budget + location + timeline, eg: '2bhk mansarovar budget 60 lakh this month'):\n" +
              "  → Use more DIRECT, FAST style. Ask specific next step (visit, call, shortlist). Don't over-explain.\n" +
              "  Example tone: 'Sir 2BHK Mansarovar 60L ke under options hain, weekend visit schedule karein?'\n\n" +
              "- If the lead is UNSURE / JUST EXPLORING:\n" +
              "  → Use SOFT & POLITE style. Help them clarify requirements gently (budget, area, BHK).\n" +
              "  Example tone: 'Bilkul sir, aap approx budget aur preferred area bata den toh main best options suggest kar sakta hoon.'\n\n" +
              "- If the message looks like TIMEPASS / VERY VAGUE (only 'hi', 'price?', 'send details'):\n" +
              "  → Keep reply VERY SHORT, still polite. Ask ONE small clarifying question.\n" +
              "  Example tone: 'Sure sir, aapko kaunse area ya budget range me property dekhni hai?'\n\n" +
              "GENERAL RULES:\n" +
              "- Reply in 1–3 short lines, WhatsApp style. NO long paragraphs.\n" +
              "- Always end with a simple question (budget, location, BHK, timeline, visit, or call) to move conversation forward.\n" +
              "- Mention words like '2BHK/3BHK', 'budget', 'location', 'visit', 'loan' when relevant.\n" +
              "- Never sound robotic. Sound like a helpful property advisor.\n",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: 220,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiText = response.data.choices[0].message.content.trim();
    console.log("AI reply:", aiText);
    return aiText;
  } catch (err) {
    console.error(
      "OpenAI error:",
      err.response?.data || err.message || err.toString()
    );
    // fallback simple reply
    return (
      "Thank you for your message, sir/ma'am. " +
      "Aapka requirement note kar liya, hamari team aapko best property options ke saath contact karegi."
    );
  }
}



async function analyzeLead(userMessage) {
  try {
    const systemPrompt =
      "You are an AI assistant for INDIAN REAL ESTATE leads. " +
      "Most buyers are middle-class / upper-middle-class families in cities like Jaipur, Gurugram, Pune, etc. " +
      "You must analyse WhatsApp messages from property leads and return ONLY a valid JSON. No extra text.";

    const userPrompt =
      "WhatsApp message from lead:\n\n" +
      userMessage +
      "\n\n" +
      "Infer their intent and details as much as possible.\n" +
      "They may use Hinglish / short forms / spelling mistakes.\n\n" +
      "Return a JSON object with EXACTLY these fields:\n" +
      "{\n" +
      '  "qualificationLevel": "hot" | "warm" | "cold",\n' +
      '  "budget": string | null,               // e.g. \"40-50L\", \"up to 80L\", \"1 cr+\"\n' +
      '  "timeline": string | null,             // e.g. \"this month\", \"2-3 months\", \"just exploring\"\n' +
      '  "useCase": string | null,              // e.g. \"2BHK for family in Mansarovar\", \"plot in Ajmer Road\"\n' +
      '\n' +
      '  "aiIntent": string | null,             // e.g. \"buying\", \"renting\", \"investing\", \"price_enquiry\", \"visit_booking\"\n' +
      '  "aiUrgency": "low" | "medium" | "high" | null,\n' +
      '  "aiNotes": string | null,              // 1-3 lines: simple summary for human sales agent\n' +
      '  "aiTags": string[] | null,             // e.g. [\"2bhk\", \"jaipur\", \"end_user\", \"loan_needed\"]\n' +
      '\n' +
      '  "score": number | null,                // 0–100: overall lead quality\n' +
      '\n' +
      '  "willRespondScore": number | null,     // 0–100: how likely they will reply if we follow-up\n' +
      '  "willBuyScore": number | null,         // 0–100: how likely they will buy in next 90 days\n' +
      '  "priorityLevel": "low" | "medium" | "high",\n' +
      '  "engagementNotes": string | null,      // short explanation for agent: \"looks serious but needs loan approval\" etc.\n' +
      '\n' +
      '  "isFake": boolean,                     // true if spam / test / wrong / broker timepass\n' +
      '  "fakeReason": string | null            // why it is fake / low-quality / timepass\n' +
      "}\n\n" +
      "Guidelines (VERY IMPORTANT):\n" +
      "- Mark qualificationLevel = \"hot\" when: clear budget, clear location, clear timeline (within 0–3 months), and strong intent to visit or buy.\n" +
      "- Mark qualificationLevel = \"warm\" when: some intent but not urgent, or just exploring within 3–6 months.\n" +
      "- Mark qualificationLevel = \"cold\" when: very vague, just checking price, or no clear timeline.\n\n" +
      "- Mark isFake = true when:\n" +
      "  * message is random gibberish like 'gdfgdf', 'test', 'hello', 'hi' with no context,\n" +
      "  * only abuse / joke / spam,\n" +
      "  * clearly broker/reseller trying to sell their own service,\n" +
      "  * obviously wrong context (job enquiry, selling car, etc. not about property).\n" +
      "- For gibberish like 'gfdhdfh', 'hii', 'ok', treat as very low-quality:\n" +
      "  * isFake: true,\n" +
      "  * fakeReason: \"random / test / no buying intent\".\n\n" +
      "- If buyer mentions family, kids school, safe area, metro, etc., increase willBuyScore.\n" +
      "- If buyer says 'sir just checking', 'forward karo', 'only price', keep score low.\n" +
      "- Always return VALID JSON ONLY.";

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 350,
        temperature: 0.25,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const content = response.data.choices[0].message.content.trim();
    console.log("AnalyzeLead raw:", content);

    let data;
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.error("JSON parse error in analyzeLead:", e);
      return null;
    }

    // small normalization safety
    if (!data.aiUrgency && data.urgency) {
      data.aiUrgency = data.urgency;
    }
    if (!data.aiIntent && data.intent) {
      data.aiIntent = data.intent;
    }

    return data;
  } catch (err) {
    console.error(
      "analyzeLead error:",
      err.response?.data || err.message || err.toString()
    );
    return null;
  }
}


async function generateHindiVoiceBuffer(text) {
  try {
    const finalText = "Hindi real estate sales tone, friendly:\n\n" + text;

    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: finalText,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    return Buffer.from(response.data);
  } catch (err) {
    if (err.response?.data) {
      const msg = err.response.data.toString();
      console.error("TTS error body:", msg);
      if (msg.includes("insufficient_quota")) {
        console.warn("⚠️ OpenAI TTS quota exceeded. Skipping voice note.");
        return null;
      }
    }
    console.error("TTS error:", err.message || err);
    return null;
  }
}
async function getSalesCoachAdvice(lead) {
  try {
    const prompt = `
Lead context:
- Latest message: "${lead.lastMessage || ''}"
- Score: ${lead.score}
- Intent: ${lead.aiIntent}
- Urgency: ${lead.aiUrgency}
- Budget: ${lead.budget}

Return JSON only:
{
  "suggestedReply": "short reply text",
  "closingTip": "how to close conversation",
  "objectionHandling": [
    { "label": "too expensive", "reply": "..." },
    { "label": "not now", "reply": "..." }
  ],
  "warning": string | null
}`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a WhatsApp sales coach assistant." },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return JSON.parse(response.data.choices[0].message.content);
  } catch (err) {
    console.error("AI Coach error:", err);
    return null;
}
  }
  async function getSalesCoachAdvice(lead) {
  try {
    const latestMsg =
      lead.lastMessage ||
      (Array.isArray(lead.messages) && lead.messages.length
        ? lead.messages[lead.messages.length - 1].text
        : "");

    const prompt = `
You are a WhatsApp sales coach for Indian agencies.
You must help human agents close more deals using short, clear messages in Hinglish (mix of Hindi + English).

Lead context:
- Latest message: "${latestMsg}"
- Score: ${lead.score ?? "null"}
- Intent: ${lead.aiIntent ?? "null"}
- Urgency: ${lead.aiUrgency ?? "null"}
- Budget: ${lead.budget ?? "null"}
- Stage: ${lead.stage ?? "null"}
- Fake flag: ${lead.isFake ? "true" : "false"}

Return ONLY valid JSON with this shape:
{
  "suggestedReply": "short Hinglish reply the agent can send now (max 2 lines)",
  "closingTip": "how to move towards booking / payment in 1-2 lines",
  "objectionHandling": [
    { "label": "too expensive", "reply": "..." },
    { "label": "not now", "reply": "..." }
  ],
  "hotAlert": "null or short text if this is a HOT lead",
  "fakeAlert": "null or short text if this looks like test/fake/junk"
}

Rules:
- suggestedReply must be polite, sales-focused, and ask a simple question.
- Use Hinglish for tone (e.g. "aap", "visit schedule kare?", "budget kya range hai?").
- Keep all replies very short and WhatsApp-friendly.
`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a WhatsApp sales coach assistant." },
          { role: "user", content: prompt },
        ],
        max_tokens: 350,
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const raw = response.data.choices[0].message.content.trim();
    console.log("SalesCoach raw:", raw);

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("SalesCoach JSON parse error:", e);
      return null;
    }

    return data;
  } catch (err) {
    console.error(
      "getSalesCoachAdvice error:",
      err.response?.data || err.message || err.toString()
    );
    return null;
  }
}



module.exports = { getAIReply, analyzeLead,  getSalesCoachAdvice,   generateHindiVoiceBuffer, generateHindiVoiceBuffer };
