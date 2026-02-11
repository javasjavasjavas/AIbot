import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ======================
// MEMORIA CONVERSACIONAL (RAM por usuario)
// ======================
const memory = new Map();

// Ajustes
const MAX_TURNS = 10; // “turnos” de usuario+bots aprox (se guarda el doble en mensajes)
const MEMORY_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas de inactividad => se borra

function getOrCreateSession(waId) {
  const now = Date.now();
  const existing = memory.get(waId);
  if (existing) {
    existing.lastSeen = now;
    return existing;
  }
  const session = { history: [], lastSeen: now };
  memory.set(waId, session);
  return session;
}

function pruneSession(session) {
  // history guarda mensajes individuales, no “turnos”, por eso usamos MAX_TURNS*2
  const maxMessages = MAX_TURNS * 2;
  if (session.history.length > maxMessages) {
    session.history = session.history.slice(-maxMessages);
  }
}

function cleanupOldSessions() {
  const now = Date.now();
  for (const [waId, session] of memory.entries()) {
    if (now - session.lastSeen > MEMORY_TTL_MS) {
      memory.delete(waId);
    }
  }
}
// Limpieza cada 10 minutos
setInterval(cleanupOldSessions, 1000 * 60 * 10);

// ======================
// ROUTES
// ======================
app.get("/", (req, res) =>
  res.send(`Bot OK ✅ | Gemini: ${GEMINI_MODEL} | Memoria: RAM`)
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
  // Responder rápido 200 a Meta
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (!value?.messages?.length) return;

    const message = value.messages[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;
    const textReceived = message?.text?.body || "";

    // Corrección Argentina: 549xxxxxxxxx -> 54xxxxxxxxx
    if (waId?.startsWith("549")) waId = "54" + waId.substring(3);

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    const lowerText = textReceived.toLowerCase().trim();

    // Comandos para controlar memoria
    if (lowerText === "reset" || lowerText === "reiniciar" || lowerText === "borrar memoria") {
      memory.delete(waId);
      await sendText(waId, "🧠✅ Listo. Borré la memoria de esta conversación.");
      return;
    }

    // Regla simple de negocio (tu ejemplo)
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta") || lowerText.includes("cuanto cuesta")) {
      await sendText(waId, "💰 *Nuestros Planes:*");
      await sendImage(waId, "https://picsum.photos/seed/p1/600/400", "🌟 *Plan Básico*\n$1.000");
      await sendImage(waId, "https://picsum.photos/seed/p2/600/400", "🚀 *Plan Pro*\n$2.500");
      return;
    }

    if (!textReceived.trim()) {
      await sendText(waId, "🙂 ¿Podés escribirme tu consulta en texto?");
      return;
    }

    // ======================
    // MEMORIA: guardar conversación
    // ======================
    const session = getOrCreateSession(waId);

    // Guardamos lo que dijo el usuario
    session.history.push({ role: "user", text: textReceived });

    // Pedimos respuesta con memoria + prompt “más largo y detallado”
    const aiResponse = await askGeminiWithMemory(session.history);

    // Guardamos respuesta del bot
    session.history.push({ role: "model", text: aiResponse });

    // Recortar historial (para costo/velocidad)
    pruneSession(session);

    // Enviar en partes si es muy largo
    await sendLongText(waId, aiResponse);

  } catch (err) {
    console.error("❌ Error General Webhook:", err);
  }
});

// ======================
// GEMINI con memoria + respuestas detalladas
// ======================
async function askGeminiWithMemory(history) {
  try {
    if (!GEMINI_API_KEY) {
      console.error("❌ Falta GEMINI_API_KEY");
      return "Estoy sin conexión con la IA (API Key faltante).";
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    // “Sistema” + historial completo
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `
Eres un asistente inteligente que responde en español.
Da respuestas claras, desarrolladas y bien estructuradas.
Si el tema lo requiere, explica en varios párrafos.
Incluye ejemplos simples cuando ayuden.
Si el usuario hace una pregunta ambigua, haz 1 o 2 preguntas de aclaración.
Mantén coherencia con lo dicho anteriormente en la conversación.
Evita respuestas excesivamente cortas: desarrolla lo necesario, sin relleno.
`
          }
        ]
      },
      ...history.map(turn => ({
        role: turn.role, // "user" | "model"
        parts: [{ text: turn.text }]
      }))
    ];

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1500,
          topP: 0.9
        }
      })
    });

    const data = await response.json();

    if (!response.ok || data?.error) {
      console.error("❌ Error API Google:", {
        status: response.status,
        statusText: response.statusText,
        error: data?.error
      });
      return "Tuve un problema al responder 😅 ¿Querés intentar otra vez?";
    }

    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || "No pude generar una respuesta clara esta vez.";
  } catch (error) {
    console.error("❌ Error en askGeminiWithMemory:", error);
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
    const err = await safeRead(r);
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
      messaging_product: "w_
