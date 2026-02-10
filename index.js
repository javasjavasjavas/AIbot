import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ✅ Modelo estable (podés cambiarlo por env var GEMINI_MODEL)
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.get("/", (req, res) =>
  res.send(`Bot OK ✅ | Gemini model: ${GEMINI_MODEL}`)
);

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // WhatsApp exige responder rápido 200
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;

    // Mensaje de texto
    const textReceived = message?.text?.body || "";

    // Corrección para Argentina (si te llega 549..., lo pasamos a 54...)
    if (waId?.startsWith("549")) {
      waId = "54" + waId.substring(3);
    }

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    // Reglas simples antes de IA
    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta") || lowerText.includes("cuanto cuesta")) {
      await sendText(waId, "💰 *Nuestros Planes:*");
      await sendImage(waId, "https://picsum.photos/seed/p1/600/400", "🌟 *Plan Básico*\n$1.000");
      await sendImage(waId, "https://picsum.photos/seed/p2/600/400", "🚀 *Plan Pro*\n$2.500");
      return;
    }

    // Si no vino texto, no llamamos a Gemini
    if (!textReceived.trim()) {
      await sendText(waId, "Recibí tu mensaje 🙂 ¿Podés escribirme tu consulta en texto?");
      return;
    }

    const aiResponse = await askGemini(textReceived);
    await sendText(waId, aiResponse);
  } catch (err) {
    console.error("❌ Error General Webhook:", err);
  }
});

// ======================
// GEMINI
// ======================
async function askGemini(prompt) {
  try {
    if (!GEMINI_API_KEY) {
      console.error("❌ Falta GEMINI_API_KEY en variables de entorno");
      return "Estoy sin conexión con la IA (API Key faltante). ¿En qué más puedo ayudarte? 🤖";
    }

    // ✅ Modelo estable (evita -latest que suele romperse)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `Responde de forma breve, amable y en español. Usuario: ${prompt}` }
            ],
          },
        ],
        // Opcional: baja un poco “randomness”
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 300,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok || data?.error) {
      console.error("❌ Error API Google:", {
        status: response.status,
        statusText: response.statusText,
        error: data?.error,
      });

      // Mensaje amable al usuario
      return "Hola! Mi IA tuvo un problema al responder 😅 ¿Podés intentar de nuevo en un minuto?";
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return text || "Recibí tu mensaje, pero no pude generar una respuesta clara.";
  } catch (error) {
    console.error("❌ Error en askGemini:", error);
    return "Hubo un error al procesar tu mensaje. 🧠🔄";
  }
}

// ======================
// WHATSAPP SENDERS
// ======================
async function sendText(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!r.ok) {
    const err = await safeJson(r);
    console.error("❌ sendText error:", r.status, err);
  }
}

async function sendImage(to, imageUrl, caption) {
  const fbUrl = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const r = await fetch(fbUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption },
    }),
  });

  if (!r.ok) {
    const err = await safeJson(r);
    console.error("❌ sendImage error:", r.status, err);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

// ======================
// START SERVER
// ======================
const port = process.env.PORT || 1000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
