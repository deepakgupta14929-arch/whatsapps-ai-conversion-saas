// services/whatsapp.service.js
const axios = require("axios");
const FormData = require("form-data");

async function sendWhatsAppText(user, toPhone, message) {
  try {
    if (!user || !user.whatsappAccessToken || !user.phoneNumberId) {
      return { ok: false, error: "WhatsApp not connected" };
    }

    const url = `https://graph.facebook.com/v20.0/${user.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "text",
      text: { preview_url: false, body: message },
    };

    const headers = {
      Authorization: `Bearer ${user.whatsappAccessToken}`,
      "Content-Type": "application/json",
    };

    const response = await axios.post(url, payload, { headers });
    return { ok: true, data: response.data };
  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.error("WhatsApp API error:", errorData);
    return { ok: false, error: errorData };
  }
}

async function uploadWhatsAppAudio(user, audioBuffer) {
  try {
    if (!user || !user.whatsappAccessToken || !user.phoneNumberId) {
      console.error("uploadWhatsAppAudio: WhatsApp not connected");
      return null;
    }

    const url = `https://graph.facebook.com/v20.0/${user.phoneNumberId}/media`;

    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", audioBuffer, {
      filename: "voice-note.mp3",
      contentType: "audio/mpeg",
    });

    const response = await axios.post(url, formData, {
      headers: {
        Authorization: `Bearer ${user.whatsappAccessToken}`,
        ...formData.getHeaders(),
      },
    });

    return response.data.id;
  } catch (err) {
    console.error(
      "WhatsApp media upload error:",
      err.response?.data || err.message
    );
    return null;
  }
}

async function sendWhatsAppAudio(user, toPhone, mediaId) {
  try {
    if (!user || !user.whatsappAccessToken || !user.phoneNumberId) {
      return { ok: false, error: "WhatsApp not connected" };
    }
    if (!mediaId) {
      return { ok: false, error: "Missing mediaId" };
    }

    const url = `https://graph.facebook.com/v20.0/${user.phoneNumberId}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: toPhone,
      type: "audio",
      audio: { id: mediaId },
    };

    const headers = {
      Authorization: `Bearer ${user.whatsappAccessToken}`,
      "Content-Type": "application/json",
    };

    const response = await axios.post(url, payload, { headers });
    return { ok: true, data: response.data };
  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.error("WhatsApp AUDIO send error:", errorData);
    return { ok: false, error: errorData };
  }
}

module.exports = { sendWhatsAppText, uploadWhatsAppAudio, sendWhatsAppAudio };
