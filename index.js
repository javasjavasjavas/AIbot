import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Opcional: si querés mandar la imagen real de planes, subila a una URL pública y ponela acá
// (WhatsApp solo puede enviar imágenes por link público)
const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || ""; // ej: https://tuweb.com/planes.png
const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || ""; // ej: https://tuweb.com/clases.png

// ======================
// MEMORIA CONVERSACIONAL (RAM)
// ======================
const memory = new Map();

const MAX_TURNS = 10; // turnos aprox (user+bot). Se guarda como mensajes, por eso *2 al recortar
const MEMORY_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas

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

setInterval(cleanupOldSessions, 1000 * 60 * 10);

// ======================
// DATOS DEL GIMNASIO (Planes + Clases)
// ======================
function formatPlansText() {
  // Según tu imagen:
  // Plan Black: $42.990/mes, 12 meses fidelidad, inscripción gratis, incluye acceso a sedes LatAm, 5 pases, sillones, etc. (NO sin permanencia mínima)
  // Plan Fit:   $34.990/mes, 12 meses fidelidad, inscripción gratis, más básico
  // Plan Smart: $39.990/mes, sin fidelidad, inscripción gratis, sin permanencia mínima (NO pases, NO sillones)
  return (
    "💳 *Planes disponibles:*\n\n" +
    "🖤 *Plan Black* — *$42.990/mes*\n" +
    "• 12 meses de fidelidad\n" +
    "• Inscripción gratis\n" +
    "• Acceso a área de peso libre, peso integrado, cardio y clases grupales\n" +
    "• Acceso a sedes del país y Latinoamérica\n" +
    "• Smart Fit app\n" +
    "• 5 pases al mes para invitar amigos\n" +
    "• Sillones de masaje\n\n" +
    "💪 *Plan Fit* — *$34.990/mes*\n" +
    "• 12 meses de fidelidad\n" +
    "• Inscripción gratis\n" +
    "• Área de peso libre, peso integrado, cardio y clases grupales\n" +
    "• Smart Fit app\n\n" +
    "🧠 *Plan Smart* — *$39.990/mes*\n" +
    "• Sin fidelidad\n" +
    "• Inscripción gratis\n" +
    "• Área de peso libre, peso integrado, cardio y clases grupales\n" +
    "• Smart Fit app\n" +
    "• *Sin permanencia mínima*\n\n" +
    "Si querés, decime cuál te interesa y te explico diferencias en 2 líneas 🙂"
  );
}

// Grilla según tu imagen (día/hora -> clase)
const CLASS_SCHEDULE = {
  funcional: [
    { day: "Lunes", time: "08:00" }, { day: "Lunes", time: "09:00" }, { day: "Lunes", time: "11:00" }, { day: "Lunes", time: "16:00" }, { day: "Lunes", time: "18:00" }, { day: "Lunes", time: "20:00" }, { day: "Lunes", time: "21:00" },
    { day: "Martes", time: "08:00" }, { day: "Martes", time: "09:00" }, { day: "Martes", time: "11:00" }, { day: "Martes", time: "16:00" }, { day: "Martes", time: "18:00" }, { day: "Martes", time: "21:00" },
    { day: "Miércoles", time: "08:00" }, { day: "Miércoles", time: "09:00" }, { day: "Miércoles", time: "11:00" }, { day: "Miércoles", time: "16:00" }, { day: "Miércoles", time: "18:00" }, { day: "Miércoles", time: "20:00" },
    { day: "Jueves", time: "08:00" }, { day: "Jueves", time: "09:00" }, { day: "Jueves", time: "11:00" }, { day: "Jueves", time: "16:00" }, { day: "Jueves", time: "18:00" }, { day: "Jueves", time: "21:00" },
    { day: "Viernes", time: "08:00" }, { day: "Viernes", time: "09:00" }, { day: "Viernes", time: "11:00" }, { day: "Viernes", time: "16:00" }, { day: "Viernes", time: "18:00" }, { day: "Viernes", time: "20:00" },
    { day: "Sábado", time: "11:00" }, { day: "Sábado", time: "16:00" }
  ],
  fitcombat: [
    { day: "Lunes", time: "10:00" },
    { day: "Miércoles", time: "10:00" },
    { day: "Viernes", time: "10:00" },
    { day: "Martes", time: "20:00" },
    { day: "Jueves", time: "20:00" },
    { day: "Sábado", time: "10:00" }
  ],
  zumba: [
    { day: "Martes", time: "10:00" },
    { day: "Jueves", time: "10:00" },
    { day: "Martes", time: "17:00" },
    { day: "Jueves", time: "17:00" },
    { day: "Sábado", time: "12:00" }
  ],
  abs: [
    { day: "Lunes", time: "12:00" },
    { day: "Miércoles", time: "12:00" },
    { day: "Viernes", time: "12:00" }
  ],
  stretching: [
    { day: "Martes", time: "12:00" },
    { day: "Jueves", time: "12:00" },
    { day: "Miércoles", time: "21:00" },
    { day: "Viernes", time: "21:00" }
  ],
  "full local": [
    { day: "Lunes", time: "17:00" },
    { day: "Miércoles", time: "17:00" },
    { day: "Viernes", time: "17:00" },
    { day: "Martes", time: "19:00" },
    { day: "Jueves", time: "19:00" }
  ],
  gap: [
    { day: "Lunes", time: "19:00" },
    { day: "Miércoles", time: "19:00" },
    { day: "Viernes", time: "19:00" }
  ]
};

// Alias para detectar cómo lo escribe la gente
const CLASS_ALIASES = [
  { key: "funcional", match: ["funcional"] },
  { key: "fitcombat", match: ["fitcombat", "fit combat"] },
  { key: "zumba", match: ["zumba"] },
  { key: "abs", match: ["abs", "abdominales"] },
  { key: "stretching", match: ["stretching", "estiramiento", "elongación", "elongacion"] },
  { key: "full local", match: ["full local", "full"] },
  { key: "gap", match: ["gap"] }
];

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .trim();
}

function detectClass(text) {
  const t = normalizeText(text);
  for (const a of CLASS_ALIASES) {
    for (const m of a.match) {
      if (t.includes(normalizeText(m))) return a.key;
    }
  }
  return null;
}

function formatClassSchedule(classKey) {
  const items = CLASS_SCHEDULE[classKey];
  if (!items || !items.length) return null;

  // Agrupar por día
  const byDay = {};
  for (const it of items) {
    if (!byDay[it.day]) byDay[it.day] = [];
    byDay[it.day].push(it.time);
  }
  // Ordenar horarios
  for (const day of Object.keys(byDay)) {
    byDay[day].sort();
  }

  const prettyName =
    classKey === "full local" ? "Full local" :
    classKey.charAt(0).toUpperCase() + classKey.slice(1);

  let out = `📅 *Horarios de ${prettyName}:*\n`;
  const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  for (const d of dayOrder) {
    if (byDay[d]?.length) {
      out += `• *${d}*: ${byDay[d].join(", ")}\n`;
    }
  }

  out += "\nSi querés, decime *qué día preferís* y te recomiendo el mejor horario 🙂";
  return out;
}

function isAskingPrices(text) {
  const t = normalizeText(text);
  return (
    t.includes("precio") ||
    t.includes("precios") ||
    t.includes("planes") ||
    t.includes("membresia") ||
    t.includes("membresía") ||
    t.includes("cuanto cuesta") ||
    t.includes("cuanto sale") ||
    t.includes("valor")
  );
}

function isAskingClasses(text) {
  const t = normalizeText(text);
  const hasKeyword =
    t.includes("clase") ||
    t.includes("clases") ||
    t.includes("horario") ||
    t.includes("horarios") ||
    t.includes("grilla") ||
    t.includes("cronograma");

  // O menciona una clase directamente
  const classKey = detectClass(text);
  return hasKeyword || !!classKey;
}

// ======================
// ROUTES
// ======================
app.get("/", (req, res) => {
  res.send(`Gym Bot OK ✅ | Gemini: ${GEMINI_MODEL} | Memoria: RAM`);
});

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
  // Responder rápido a Meta
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

    const lowerText = normalizeText(textReceived);

    // Comandos
    if (lowerText === "reset" || lowerText === "reiniciar" || lowerText === "borrar memoria") {
      memory.delete(waId);
      await sendText(waId, "🧠✅ Listo. Borré la memoria de esta conversación.");
      return;
    }

    if (!textReceived.trim()) {
      await sendText(waId, "🙂 ¿Podés escribirme tu consulta en texto?");
      return;
    }

    // ======================
    // 1) PRECIOS / PLANES
    // ======================
    if (isAskingPrices(textReceived)) {
      const plansText = formatPlansText();
      await sendLongText(waId, plansText);

      // Opcional: enviar imagen si existe URL pública
      if (PLANS_IMAGE_URL) {
        await sendImage(waId, PLANS_IMAGE_URL, "📌 Planes disponibles");
      }
      return;
    }

    // ======================
    // 2) CLASES / HORARIOS
    // ======================
    if (isAskingClasses(textReceived)) {
      const classKey = detectClass(textReceived);

      // Si el usuario dijo “horarios” pero no especificó clase
      if (!classKey) {
        let msg =
          "📚 Tenemos estas clases:\n" +
          "• Funcional\n• FitCombat\n• Zumba\n• ABS\n• Stretching\n• Full local\n• GAP\n\n" +
          "Decime *cuál te interesa* y te paso días y horarios.";

        await sendText(waId, msg);

        if (CLASSES_IMAGE_URL) {
          await sendImage(waId, CLASSES_IMAGE_URL, "🗓️ Grilla de clases");
        }
        return;
      }

      const scheduleText = formatClassSchedule(classKey);
      await sendLongText(waId, scheduleText || "No encontré horarios para esa clase.");

      // Opcional: enviar imagen
      if (CLASSES_IMAGE_URL) {
        await sendImage(waId, CLASSES_IMAGE_URL, "🗓️ Grilla de clases");
      }
      return;
    }

    // ======================
    // 3) DEFAULT: Gemini con memoria
    // ======================
    const session = getOrCreateSession(waId);

    // Guardar user
    session.history.push({ role: "user", text: textReceived });

    const aiResponse = await askGeminiWithMemory(session.history);

    // Guardar bot
    session.history.push({ role: "model", text: aiResponse });

    pruneSession(session);

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

    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `
Eres un asistente inteligente para un gimnasio.
Respondes siempre en español, con tono amable y profesional.
Da respuestas claras, desarrolladas y bien estructuradas.
Si el tema lo requiere, explica en varios párrafos y con ejemplos simples.
Si una consulta es ambigua, haz 1 o 2 preguntas para aclarar.
Mantén coherencia con lo dicho anteriormente en esta conversación.
Evita respuestas demasiado cortas: desarrolla lo necesario, sin relleno.
`
          }
        ]
      },
      ...history.map((turn) => ({
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

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || "No pude generar una respuesta clara esta vez.";
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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    })
  });

  if (!response.ok) {
    const err = await safeRead(response);
    console.error("❌ sendText error:", response.status, err);
  }
}

async function sendImage(to, imageUrl, caption) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "image",
      image: {
        link: imageUrl,
        caption: caption
      }
    })
  });

  if (!response.ok) {
    const err = await safeRead(response);
    console.error("❌ sendImage error:", response.status, err);
  }
}

// WhatsApp ~4096 chars. Usamos 3500 para ir seguros.
async function sendLongText(to, text, chunkSize = 3500) {
  const clean = (text || "").trim();
  if (!clean) return;

  if (clean.length <= chunkSize) {
    await sendText(to, clean);
    return;
  }

  for (let i = 0; i < clean.length; i += chunkSize) {
    const chunk = clean.slice(i, i + chunkSize);
    await sendText(to, chunk);
  }
}

async function safeRead(response) {
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
app.listen(port, "0.0.0.0", () => console.log(`🚀 Server on port ${port}`));
