import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Incoming messages
app.post("/webhook", async (req, res) => {
  // Respondemos 200 rápido
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];
    if (!message) return;

    const text = message?.text?.body || "";

    // 🔑 wa_id REAL y autorizado por Meta
    const waId = value?.contacts?.[0]?.wa_id || message.from;

    console.log("📩 message.from:", message.from);
    console.log("👤 contacts[0].wa_id:", value?.contacts?.[0]?.wa_id);
    console.log("📤 waId usado para responder:", waId);
    console.log("📝 Texto:", text);

    // Normalización Argentina (por seguridad)
    let to = waId;
    if (to.startsWith("54") && !to.startsWith("549")) {
      to = "549" + to.slice(2);
    }

    console.log("📤 TO (final):", to);

    await sendText(to, `🤖 Bot activo. Dijiste: "${text}"`);
  } catch (err) {
    console.error("Webhook processing error:", err?.message || err);
  }
});

async function sendText(to, body) {
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
      type: "text",
      text: { body },
    }),
  });

  const data = await resp.text();

  if (!resp.ok) {
    throw new Error(`sendText failed (${resp.status}): ${data}`);
  }

  return JSON.parse(data);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
