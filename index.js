import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
// Opcional: tu número de WA business (solo dígitos) para evitar responderte a vos mismo si llega
const BUSINESS_WA_ID = process.env.BUSINESS_WA_ID; // ej: "15551688469"

app.get("/", (req, res) => {
  res.send("Bot WhatsApp OK");
});

// Webhook verification (Meta)
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

// Incoming events (messages, statuses, etc.)
app.post("/webhook", async (req, res) => {
  // Respondemos 200 enseguida para que Meta no reintente
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Log mínimo para debug (no imprimas tokens)
    console.log("📦 Incoming webhook keys:", {
      hasMessages: Boolean(value?.messages?.length),
      hasStatuses: Boolean(value?.statuses?.length),
      metadata: value?.metadata ? { phone_number_id: value.metadata.phone_number_id } : null,
    });

    // Si llega un status update (delivery/read), lo ignoramos
    const status = value?.statuses?.[0];
    if (status && !value?.messages?.length) {
      console.log("ℹ️ Status update:", {
        id: status.id,
        status: status.status,
        recipient_id: status.recipient_id,
        timestamp: status.timestamp,
      });
      return;
    }

    const message = value?.messages?.[0];
    if (!message) {
      console.log("ℹ️ No message found (ignored).");
      return;
    }

    const from = message.from; // wa_id real (solo dígitos)
    const text = message?.text?.body || "";
    const msgType = message.type;

    // Logueo CLAVE: esto nos dice el wa_id exacto que Meta usa
    console.log("📩 FROM (wa_id):", from);
    console.log("🧾 Message:", { id: message.id, type: msgType, timestamp: message.timestamp });
    console.log("📝 Text:", text);

    // Evitar loops si por alguna razón llega un mensaje del propio business
    if (BUSINESS_WA_ID && from === BUSINESS_WA_ID) {
      console.log("↩️ Ignored: message from business wa_id (loop prevention).");
      return;
    }

    // Solo respondemos a texto por ahora
    if (msgType !== "text") {
      await safeSend(from, "Por ahora solo entiendo mensajes de texto 🙂");
      return;
    }

    // ✅ Normalización AR: si viene 54... pero no 549..., lo convertimos a 549...
    let to = from;
    if (to.startsWith("54") && !to.startsWith("549")) {
      to = "549" + to.slice(2);
    }
    console.log("📤 TO (normalized):", to);

    await safeSend(to, `🤖 Bot activo. Dijiste: "${text}"`);
  } catch (err) {
    console.error("Webhook processing error:", err?.message || err);
  }
});

async function safeSend(to, body) {
  try {
    const result = await sendText(to, body);
    console.log("✅ Sent OK:", result);
  } catch (err) {
    console.error("❌ sendText error:", err?.message || err);
  }
}

async function sendText(to, body) {
  if (!WHATSAPP_TOKEN) throw new Error("Missing env WHATSAPP_TOKEN");
  if (!PHONE_NUMBER_ID) throw new Error("Missing env PHONE_NUMBER_ID");

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

  const dataText = await resp.text();

  if (!resp.ok) {
    throw new Error(`sendText failed (${resp.status}): ${dataText}`);
  }

  // Meta responde JSON
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
