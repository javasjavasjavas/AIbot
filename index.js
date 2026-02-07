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

  console.warn("❌ Webhook verification failed", { mode, token });
  return res.sendStatus(403);
});

// Incoming messages
app.post("/webhook", async (req, res) => {
  // Siempre respondemos 200 rápido para que Meta no reintente
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const message = value?.messages?.[0];

    // A veces llegan status updates, etc.
    if (!message) {
      // Log útil para ver qué está llegando
      const statuses = value?.statuses?.[0];
      if (statuses) {
        console.log("ℹ️ Status update:", {
          id: statuses.id,
          status: statuses.status,
          recipient_id: statuses.recipient_id,
          timestamp: statuses.timestamp
        });
      } else {
        console.log("ℹ️ No message in payload (ignored)");
      }
      return;
    }

    const from = message.from; // wa_id real del usuario
    const text = message?.text?.body || "";

    // 🔥 Esto es lo clave para tu caso:
    console.log("📩 INCOMING FROM (wa_id):", from);
    console.log("📝 TEXT:", text);

    // Log extra (recortado) por si hace falta
    console.log("🔎 MESSAGE META:", {
      id: message.id,
      type: message.type,
      timestamp: message.timestamp
    });

    const reply = `🤖 Bot activo. Dijiste: "${text}"`;
    const result = await sendText(from, reply);

    console.log("✅ Sent reply OK:", result);
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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    })
  });

  const dataText = await resp.text();

  if (!resp.ok) {
    // Esto te va a mostrar EXACTO por qué falla (ej 131030)
    throw new Error(`sendText failed (${resp.status}): ${dataText}`);
  }

  // dataText suele ser JSON, pero lo devolvemos parseado si se puede
  try {
    return JSON.parse(dataText);
  } catch {
    return { raw: dataText };
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
