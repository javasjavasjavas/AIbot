import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ALLOWED_TEST_NUMBER = process.env.ALLOWED_TEST_NUMBER;

// Health check
app.get("/", (req, res) => {
  res.send("Bot WhatsApp OK");
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Incoming messages
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];
    if (!message) return res.sendStatus(200);

    // wa_id ES el número real autorizado
    const waId = value?.contacts?.[0]?.wa_id;
    const text = message?.text?.body || "";

    console.log("📩 FROM (wa_id):", waId);
    console.log("💬 TEXT:", text);

    // 🚨 Sandbox restriction
    if (waId !== ALLOWED_TEST_NUMBER) {
      console.warn("⛔ Número no autorizado en sandbox:", waId);
      return res.sendStatus(200);
    }

    await sendText(waId, `🤖 Bot activo. Dijiste: "${text}"`);
    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.sendStatus(200);
  }
});

async function sendText(to, body) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    })
  });

  if (!resp.ok) {
    const data = await resp.text();
    throw new Error(`sendText failed (${resp.status}): ${data}`);
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
