import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const app = express();
app.use(express.json());

// ======================
// ENV
// ======================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Texto (coach / conversación)
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

// Imagen (ejercicios)
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

// Para enviar imágenes por WhatsApp: debe ser URL pública (tu app en Render)
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// Opcional: URLs públicas de tus imágenes informativas (planes / grilla)
const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";

// ======================
// STORAGE DE IMÁGENES GENERADAS
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// Servimos las imágenes generadas
app.use("/img", express.static(GENERATED_DIR));

// ======================
// MEMORIA CONVERSACIONAL (RAM)
// ======================
const memory = new Map();

const MAX_TURNS = 10;
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
// DATOS GIMNASIO (Planes + Clases)
// ======================
function formatPlansText() {
  return (
    "💳 *Planes disponibles:*\n\n" +
    "🖤 *Plan Black* — *$42.990/mes*\n" +
    "• 12 meses de fidelidad\n" +
    "• Inscripción gratis\n" +
    "• Peso libre + cardio + clases grupales\n" +
    "• Acceso a sedes del país y Latinoamérica\n" +
    "• Smart Fit app\n" +
    "• 5 pases/mes para invitar amigos\n" +
    "• Sillones de masaje\n\n" +
    "💪 *Plan Fit* — *$34.990/mes*\n" +
    "• 12 meses de fidelidad\n" +
    "• Inscripción gratis\n" +
    "• Peso libre + cardio + clases grupales\n" +
    "• Smart Fit app\n\n" +
    "🧠 *Plan Smart* — *$39.990/mes*\n" +
    "• Sin fidelidad\n" +
    "• Inscripción gratis\n" +
    "• Peso libre + cardio + clases grupales\n" +
    "• Smart Fit app\n" +
    "• *Sin permanencia mínima*\n\n" +
    "Decime cuál te interesa y te lo comparo en 2 líneas 🙂"
  );
}

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

const CLASS_ALIASES = [
  { key: "funcional", match: ["funcional"] },
  { key: "fitcombat", match: ["fitcombat", "fit combat"] },
  { key: "zumba", match: ["zumba"] },
  { key: "abs", match: ["abs", "abdominales"] },
  { key: "stretching", match: ["stretching", "estiramiento", "elongacion", "elongación"] },
  { key: "full local", match: ["full local", "full"] },
  { key: "gap", match: ["gap"] }
];

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

  const byDay = {};
  for (const it of items) {
    if (!byDay[it.day]) byDay[it.day] = [];
    byDay[it.day].push(it.time);
  }
  for (const d of Object.keys(byDay)) byDay[d].sort();

  const prettyName = classKey === "full local" ? "Full local" : classKey.toUpperCase() === "ABS" ? "ABS" : (classKey.charAt(0).toUpperCase() + classKey.slice(1));

  const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  let out = `📅 *Horarios de ${prettyName}:*\n`;
  for (const d of dayOrder) {
    if (byDay[d]?.length) out += `• *${d}*: ${byDay[d].join(", ")}\n`;
  }
  out += "\nSi me decís tu día preferido, te recomiendo el mejor horario 🙂";
  return out;
}

function isAskingPrices(text) {
  const t = normalizeText(text);
  return (
    t.includes("precio") ||
    t.includes("precios") ||
    t.includes("planes") ||
    t.includes("membresia") ||
    t.includes("cuanto cuesta") ||
    t.includes("cuanto sale") ||
    t.includes("valor")
  );
}

function isAskingClasses(text) {
  const t = normalizeText(text);
  const hasKeyword = t.includes("clase") || t.includes("clases") || t.includes("horario") || t.includes("horarios") || t.includes("grilla");
  return hasKeyword || !!detectClass(text);
}

// ======================
// MODO PROFESOR (EJERCICIOS)
// ======================
function isExerciseQuery(text) {
  const t = normalizeText(text);
  const keywords = [
    "ejercicio", "tecnica", "técnica", "como hago", "como se hace", "cómo se hace",
    "forma correcta", "postura", "errores", "me duele", "dolor", "consejos"
  ];
  const exerciseNames = [
    "sentadilla", "squat", "peso muerto", "deadlift", "press banca", "bench press",
    "press militar", "shoulder press", "dominadas", "pull up", "rem o", "remo",
    "zancadas", "lunge", "plancha", "plank", "curl biceps", "biceps", "triceps",
    "hip thrust", "puente de gluteos", "glute bridge", "abdominal", "crunch"
  ];
  return keywords.some(k => t.includes(normalizeText(k))) || exerciseNames.some(n => t.includes(normalizeText(n)));
}

// Prompt para que Gemini devuelva una explicación MUY útil
function buildCoachPrompt(userText) {
  return `
Actúa como PROFESOR/A DE GIMNASIO (entrenador personal).
Responde en español, claro, amable y profesional.

El usuario pregunta: "${userText}"

Quiero que tu respuesta tenga SIEMPRE esta estructura:
1) Qué trabaja el ejercicio (músculos principales y secundarios).
2) Técnica paso a paso (lista numerada).
3) 5 errores comunes y cómo corregirlos.
4) Respiración y ritmo.
5) Variantes (principiante / intermedio / avanzado).
6) Señales de alerta (si hay dolor, cuándo parar).
7) Un ejemplo de rutina corta (2-3 series con repeticiones) si aplica.

Sé detallado pero fácil de leer (párrafos cortos y viñetas).
`;
}

// Prompt para generar la imagen correcta (sin texto en la imagen)
function buildExerciseImagePrompt(exerciseNameOrQuestion) {
  return `
Create a clean instructional fitness illustration showing the correct execution of:
"${exerciseNameOrQuestion}"

Style:
- Minimal, high-clarity instructional poster
- White background
- Two-panel layout: left "Start position", right "End position"
- Human figure with neutral gym clothing, no logos
- Show correct posture, joint alignment, and range of motion
- No text, no labels, no watermarks, no extra objects
- Front or 3/4 view depending on what best shows form
`;
}

// Genera imagen con Gemini native image generation (Nano Banana)
// La respuesta trae parts con inlineData (base64) según la doc. :contentReference[oaicite:1]{index=1}
async function generateExerciseImageAndSave(promptText) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      // Si tu cuenta/modelo lo requiere, esto ayuda a indicar que queremos imagen.
      // Algunos modelos devuelven imagen igual sin esto; si tuvieras problemas, lo dejamos.
      generationConfig: {
        temperature: 0.7
      }
    })
  });

  const data = await response.json();

  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Image gen failed (${response.status})`);
  }

  // Buscar inlineData en las parts
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find(p => p.inlineData?.data || p.inline_data?.data); // por compat
  const inlineData = inline?.inlineData || inline?.inline_data;

  if (!inlineData?.data) {
    throw new Error("No inline image data returned by model");
  }

  const buffer = Buffer.from(inlineData.data, "base64");
  const id = crypto.randomBytes(12).toString("hex");
  const filename = `${id}.png`;
  const filepath = path.join(GENERATED_DIR, filename);

  fs.writeFileSync(filepath, buffer);
  return { id, filename };
}

// ======================
// ROUTES
// ======================
app.get("/", (req, res) => {
  res.send(
    `Gym Coach Bot OK ✅ | Text: ${GEMINI_TEXT_MODEL} | Image: ${GEMINI_IMAGE_MODEL} | Memoria: RAM`
  );
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
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (!value?.messages?.length) return;

    const message = value.messages[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;
    const textReceived = message?.text?.body || "";

    // Corrección Argentina
    if (waId?.startsWith("549")) waId = "54" + waId.substring(3);

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    const lower = normalizeText(textReceived);

    // Comandos
    if (lower === "reset" || lower === "reiniciar" || lower === "borrar memoria") {
      memory.delete(waId);
      await sendText(waId, "🧠✅ Listo. Borré la memoria de esta conversación.");
      return;
    }

    if (!textReceived.trim()) {
      await sendText(waId, "🙂 ¿Podés escribirme tu consulta en texto?");
      return;
    }

    // ======================
    // 1) PRECIOS
    // ======================
    if (isAskingPrices(textReceived)) {
      await sendLongText(waId, formatPlansText());
      if (PLANS_IMAGE_URL) await sendImage(waId, PLANS_IMAGE_URL, "📌 Planes disponibles");
      return;
    }

    // ======================
    // 2) CLASES
    // ======================
    if (isAskingClasses(textReceived)) {
      const classKey = detectClass(textReceived);
      if (!classKey) {
        const msg =
          "📚 Tenemos estas clases:\n" +
          "• Funcional\n• FitCombat\n• Zumba\n• ABS\n• Stretching\n• Full local\n• GAP\n\n" +
          "Decime *cuál te interesa* y te paso días y horarios.";
        await sendText(waId, msg);
        if (CLASSES_IMAGE_URL) await sendImage(waId, CLASSES_IMAGE_URL, "🗓️ Grilla de clases");
        return;
      }

      await sendLongText(waId, formatClassSchedule(classKey) || "No encontré horarios para esa clase.");
      if (CLASSES_IMAGE_URL) await sendImage(waId, CLASSES_IMAGE_URL, "🗓️ Grilla de clases");
      return;
    }

    // ======================
    // 3) PROFESOR VIRTUAL (EJERCICIOS + IMAGEN)
    // ======================
    if (isExerciseQuery(textReceived)) {
      const session = getOrCreateSession(waId);
      session.history.push({ role: "user", text: textReceived });

      // 3A) Respuesta tipo coach (detallada)
      const coachResponse = await askGeminiTextWithMemory(session.history, buildCoachPrompt(textReceived));
      session.history.push({ role: "model", text: coachResponse });
      pruneSession(session);

      await sendLongText(waId, coachResponse);

      // 3B) Generar imagen del ejercicio y enviarla
      if (!PUBLIC_BASE_URL) {
        await sendText(
          waId,
          "📷 Puedo generar la imagen del ejercicio, pero falta configurar PUBLIC_BASE_URL (la URL pública de tu app) para poder enviártela por WhatsApp."
        );
        return;
      }

      try {
        await sendText(waId, "🖼️ Generando una imagen con la técnica correcta…");
        const imgPrompt = buildExerciseImagePrompt(textReceived);
        const { filename } = await generateExerciseImageAndSave(imgPrompt);
        const imageUrl = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/img/${filename}`;
        await sendImage(waId, imageUrl, "✅ Ejecución correcta (referencia visual)");
      } catch (e) {
        console.error("❌ Error generando imagen:", e);
        await sendText(waId, "Pude explicarte el ejercicio, pero falló la generación de la imagen 😅. Probá de nuevo en un minuto.");
      }

      return;
    }

    // ======================
    // 4) DEFAULT: Gemini normal con memoria
    // ======================
    const session = getOrCreateSession(waId);
    session.history.push({ role: "user", text: textReceived });

    const aiResponse = await askGeminiTextWithMemory(session.history);

    session.history.push({ role: "model", text: aiResponse });
    pruneSession(session);

    await sendLongText(waId, aiResponse);
  } catch (err) {
    console.error("❌ Error General Webhook:", err);
  }
});

// ======================
// GEMINI TEXT (con memoria)
// - Permite pasar un "overridePrompt" para modo coach (ejercicios)
// ======================
async function askGeminiTextWithMemory(history, overridePrompt = null) {
  try {
    if (!GEMINI_API_KEY) return "Estoy sin conexión con la IA (API Key faltante).";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const systemPrompt = overridePrompt
      ? overridePrompt
      : `
Eres un asistente inteligente para un gimnasio.
Respondes en español, con tono amable y profesional.
Da respuestas claras, desarrolladas y bien estructuradas.
Si el tema lo requiere, explica en varios párrafos y con ejemplos simples.
Si una consulta es ambigua, haz 1 o 2 preguntas para aclarar.
Mantén coherencia con lo dicho anteriormente en esta conversación.
Evita respuestas demasiado cortas: desarrolla lo necesario, sin relleno.
`;

    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      ...history.map(turn => ({ role: turn.role, parts: [{ text: turn.text }] }))
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
      console.error("❌ Error API Google (text):", data?.error || response.status);
      return "Tuve un problema al responder 😅 ¿Querés intentar otra vez?";
    }

    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || "No pude generar una respuesta clara esta vez.";
  } catch (e) {
    console.error("❌ askGeminiTextWithMemory:", e);
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
// START
// ======================
const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => console.log(`🚀 Server on port ${port}`));
