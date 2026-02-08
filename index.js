import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => {
  res.send("Bot WhatsApp OK");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ✅ Endpoint para chequear que el token y el phone_number_id matchean
app.get("/debug", async (req, res) => {
  try {
    const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    });
    const t = await r.text();
    return res.status(r.status).send(t);
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const metadataPhoneId = value?.metadata?.phone_number_id;

    console.log("🔧 ENV PHONE_NUMBER_ID:", PHONE_NUMBER_ID);
    console.log("📦 WEBHOOK metadata.phone_number_id:", metadataPhoneId);

    const message = value?.messages?.[0];
    if (!message) return;

    const waId = value?.contacts?.[0]?.wa_id || message.from;
    const text = message?.text?.body || "";
    console.log("📩 FROM (wa_id):", waId);
    console.log("💬 TEXT:", text);

    // probamos envío template
    await sendTemplate(waId, "hello_world", "en_US");
    console.log("✅ Template sent OK");
  } catch (err) {
    console.error("❌ Webhook error:", err?.message || err);
  }
});

async function sendTemplate(to, templateName, languageCode = "en_US") {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    }),
  });

  const data = await resp.text();
  if (!resp.ok) throw new Error(`sendTemplate failed (${resp.status}): ${data}`);
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
