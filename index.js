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
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://aibot-hsjq.onrender.com").replace(/\/$/, "");

// Modelos
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

// IMPORTANTE: forzamos image model correcto (no preview)
const ENV_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "";
const GEMINI_IMAGE_MODEL = ENV_IMAGE_MODEL.toLowerCase().includes("preview")
  ? "gemini-2.5-flash-image"
  : (ENV_IMAGE_MODEL || "gemini-2.5-flash-image");

// Opcional: imágenes informativas (URLs públicas)
const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";

// ======================
// STORAGE IMÁGENES GENERADAS
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
app.use("/img", express.static(GENERATED_DIR));

// ======================
// HEALTH / ROOT
// ======================
app.get("/", (req, res) => res.send("✅ Gym Coach Bot ONLINE"));
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    publicBaseUrl: PUBLIC_BASE_URL,
    models: { text: GEMINI_TEXT_MODEL, image: GEMINI_IMAGE_MODEL },
    env: {
      hasVerifyToken: !!VERIFY_TOKEN,
      hasWhatsappToken: !!WHATSAPP_TOKEN,
      hasPhoneNumberId: !!PHONE_NUMBER_ID,
      hasGeminiKey: !!GEMINI_API_KEY
    }
  });
});

// ======================
// HELPERS
// ======================
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Extrae retryDelay si viene en el error (como en tu log)
function extractRetryDelaySeconds(errObj) {
  try {
    const details = errObj?.details;
    if (!Array.isArray(details)) return null;
    const retryInfo = details.find((d) => d["@type"]?.includes("RetryInfo"));
    const s = retryInfo?.retryDelay;
    if (!s) return null;
    // formato típico: "46s"
    if (typeof s === "string" && s.endsWith("s")) return Number(s.replace("s", ""));
    return null;
  } catch {
    return null;
  }
}

// ======================
// RATE LIMIT SIMPLE (por usuario)
// Evita que alguien spamee y te dispare 429 todo el tiempo
// ======================
const userRate = new Map();
// max 3 requests cada 30s por usuario
const WINDOW_MS = 30_000;
const MAX_REQ_PER_WINDOW = 3;

function allowUser(waId) {
  const now = Date.now();
  const arr = userRate.get(waId) || [];
  const fresh = arr.filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_REQ_PER_WINDOW) {
    userRate.set(waId, fresh);
    return false;
  }
  fresh.push(now);
  userRate.set(waId, fresh);
  return true;
}

// ======================
// GYM INFO
// ======================
function isAskingPrices(text) {
  const t = normalizeText(text);
  return (
    t.includes("precio") ||
    t.includes("precios") ||
    t.includes("planes") ||
    t.includes("membresia") ||
    t.includes("membresía") ||
    t.includes("cuanto cuesta") ||
    t.includes("cuánto cuesta") ||
    t.includes("cuanto sale") ||
    t.includes("valor")
  );
}

function formatPlansText() {
  return (
    "💳 *Planes disponibles:*\n\n" +
    "🖤 *Plan Black* — *$42.990/mes*\n" +
    "• 12 meses de fidelidad\n• Inscripción gratis\n• Peso libre + cardio + clases\n• Acceso LatAm\n• Smart Fit app\n• 5 pases/mes\n• Sillones de masaje\n\n" +
    "💪 *Plan Fit* — *$34.990/mes*\n" +
    "• 12 meses de fidelidad\n• Inscripción gratis\n• Peso libre + cardio + clases\n• Smart Fit app\n\n" +
    "🧠 *Plan Smart* — *$39.990/mes*\n" +
    "• Sin fidelidad\n• Inscripción gratis\n• Peso libre + cardio + clases\n• Smart Fit app\n• *Sin permanencia mínima*\n"
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
    { day: "Lunes", time: "10:00" }, { day: "Miércoles", time: "10:00" }, { day: "Viernes", time: "10:00" },
    { day: "Martes", time: "20:00" }, { day: "Jueves", time: "20:00" }, { day: "Sábado", time: "10:00" }
  ],
  zumba: [
    { day: "Martes", time: "10:00" }, { day: "Jueves", time: "10:00" },
    { day: "Martes", time: "17:00" }, { day: "Jueves", time: "17:00" },
    { day: "Sábado", time: "12:00" }
  ],
  abs: [
    { day: "Lunes", time: "12:00" }, { day: "Miércoles", time: "12:00" }, { day: "Viernes", time: "12:00" }
  ],
  stretching: [
    { day: "Martes", time: "12:00" }, { day: "Jueves", time: "12:00" },
    { day: "Miércoles", time: "21:00" }, { day: "Viernes", time: "21:00" }
  ],
  "full local": [
    { day: "Lunes", time: "17:00" }, { day: "Miércoles", time: "17:00" }, { day: "Viernes", time: "17:00" },
    { day: "Martes", time: "19:00" }, { day: "Jueves", time: "19:00" }
  ],
  gap: [
    { day: "Lunes", time: "19:00" }, { day: "Miércoles", time: "19:00" }, { day: "Viernes", time: "19:00" }
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

function detectClass(text) {
  const t = normalizeText(text);
  for (const a of CLASS_ALIASES) {
    for (const m of a.match) {
      if (t.includes(normalizeText(m))) return a.key;
    }
  }
  return null;
}

function isAskingClasses(text) {
  const t = normalizeText(text);
  return t.includes("clase") || t.includes("clases") || t.includes("horario") || t.includes("horarios") || !!detectClass(text);
}

function formatClassSchedule(classKey) {
  const items = CLASS_SCHEDULE[classKey];
  if (!items?.length) return null;

  const byDay = {};
  for (const it of items) {
    if (!byDay[it.day]) byDay[it.day] = [];
    byDay[it.day].push(it.time);
  }
  for (const d of Object.keys(byDay)) byDay[d].sort();

  const pretty = classKey === "full local" ? "Full local" : classKey.toUpperCase() === "ABS" ? "ABS" : classKey.charAt(0).toUpperCase() + classKey.slice(1);
  const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  let out = `📅 *Horarios de ${pretty}:*\n`;
  for (const d of dayOrder) {
    if (byDay[d]?.length) out += `• *${d}*: ${byDay[d].join(", ")}\n`;
  }
  return out;
}

// EJERCICIOS
function isExerciseQuery(text) {
  const t = normalizeText(text);
  const keys = [
    "ejercicio", "tecnica", "técnica", "como se hace", "cómo se hace", "forma correcta", "postura", "errores",
    "sentadilla", "peso muerto", "press banca", "press de banca", "dominadas", "remo", "curl", "hip thrust", "plancha"
  ];
  return keys.some(k => t.includes(normalizeText(k)));
}

function buildCoachPrompt(userText) {
  return `
Actúa como PROFESOR/A DE GIMNASIO (entrenador personal).
Responde en español, claro, amable y profesional.

El usuario pregunta: "${userText}"

Estructura obligatoria:
1) Qué trabaja (músculos principales y secundarios).
2) Técnica paso a paso (lista numerada).
3) 5 errores comunes y corrección.
4) Respiración y ritmo.
5) Variantes (principiante / intermedio / avanzado).
6) Señales de alerta (dolor, cuándo parar).
7) Ejemplo de rutina corta.

Sé detallado pero fácil de leer.
`;
}

function buildExerciseImagePrompt(exerciseQuery) {
  return `
Ilustración técnica instructiva del ejercicio: "${exerciseQuery}"

OBJETIVO:
Mostrar la ejecución correcta del movimiento en dos fases clave.

INSTRUCCIONES OBLIGATORIAS:

- Fondo completamente blanco.
- Estilo ilustración limpia tipo manual de entrenamiento.
- Sin texto, sin títulos, sin etiquetas, sin letras, sin números.
- Sin marcas de agua.
- Misma persona, mismo ángulo de cámara en ambos paneles.
- Dos paneles apilados verticalmente separados por una línea fina.

INTERPRETACIÓN DEL MOVIMIENTO:

1. Analiza el ejercicio y determina automáticamente:
   - La posición de inicio biomecánicamente correcta.
   - La posición de máxima contracción o máxima flexión del movimiento.

2. Representa:
   - Panel superior: fase inicial estable del movimiento.
   - Panel inferior: fase de mayor recorrido o contracción.

3. Debe respetar:
   - Alineación articular correcta.
   - Postura segura.
   - Técnica estándar de gimnasio.
   - Muñecas alineadas.
   - Columna neutra o adecuada al ejercicio.
   - Activación correcta de la cadena muscular principal.

4. Evitar errores comunes del ejercicio.

NO AGREGAR TEXTO.
NO USAR INGLÉS.
NO INCLUIR ETIQUETAS.
`;
}

// ======================
// WEBHOOK VERIFY (GET)
// ======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado OK");
    return res.status(200).send(challenge);
  }
  console.log("❌ Webhook verify falló");
  return res.sendStatus(403);
});

// ======================
// WEBHOOK POST
// ======================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;

    console.log("📥 Webhook value:", JSON.stringify(value || {}, null, 2));

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;

    // Argentina 549 -> 54
    if (waId?.startsWith("549")) waId = "54" + waId.substring(3);

    const text = message?.text?.body || "";
    if (!text.trim()) return;

    // Rate limit por usuario (evita spam)
    if (!allowUser(waId)) {
      await sendText(waId, "⏳ Estoy recibiendo muchas consultas muy rápido. Probá de nuevo en 30 segundos 🙂");
      return;
    }

    // PRECIOS
    if (isAskingPrices(text)) {
      await sendLongText(waId, formatPlansText());
      if (PLANS_IMAGE_URL) await sendImage(waId, PLANS_IMAGE_URL, "Planes disponibles");
      return;
    }

    // CLASES
    if (isAskingClasses(text)) {
      const ck = detectClass(text);
      if (!ck) {
        await sendText(waId, "📚 Decime cuál clase: Funcional, FitCombat, Zumba, ABS, Stretching, Full local, GAP.");
        if (CLASSES_IMAGE_URL) await sendImage(waId, CLASSES_IMAGE_URL, "Grilla de clases");
        return;
      }
      await sendLongText(waId, formatClassSchedule(ck) || "No encontré horarios para esa clase.");
      return;
    }

    // EJERCICIOS + IMAGEN
    if (isExerciseQuery(text)) {
      // Texto con retry
      const explanation = await askGeminiTextWithRetry(buildCoachPrompt(text));
      await sendLongText(waId, explanation);

      // Imagen con retry (si falla, no rompe el bot)
      try {
        await sendText(waId, "🖼️ Generando imagen técnica...");
        const filename = await generateExerciseImageAndSaveWithRetry(buildExerciseImagePrompt(text));
        const imgUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
        await sendImage(waId, imgUrl, "✅ Ejecución correcta (referencia)");
      } catch (e) {
        console.error("❌ Imagen falló:", e?.message || e);
        await sendText(waId, "Pude explicarte el ejercicio, pero la imagen falló por cuota/modelo. Probá en 1 minuto.");
      }
      return;
    }

    // DEFAULT
    const fallback = await askGeminiTextWithRetry(
      `Sos un asistente de gimnasio. Responde en español, claro y útil.\nUsuario: ${text}`
    );
    await sendLongText(waId, fallback);

  } catch (err) {
    console.error("❌ Error webhook:", err);
  }
});

// ======================
// GEMINI TEXT (con retry 429)
// ======================
async function askGeminiTextWithRetry(prompt, maxAttempts = 3) {
  if (!GEMINI_API_KEY) return "⚠️ Falta GEMINI_API_KEY en Render.";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 1200, topP: 0.9 }
      })
    });

    const data = await safeRead(response);

    if (response.ok && !data?.error) {
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No pude generar respuesta.";
    }

    // 429 -> esperar y reintentar
    const code = data?.error?.code || response.status;
    if (code === 429 && attempt < maxAttempts) {
      const retryS = extractRetryDelaySeconds(data?.error) ?? (15 * attempt);
      console.error("❌ Gemini text 429:", data?.error?.message || data, "| retry in", retryS, "s");
      await sleep((retryS + 1) * 1000);
      continue;
    }

    console.error("❌ Gemini text error:", data?.error || data);
    // Mensaje más útil (incluye hint del problema real)
    return "Tuve un problema al responder 😅. Si esto pasa seguido, revisá que tu *API Key* sea del proyecto con billing (si no, te aplica free tier). Probá de nuevo en 1 minuto.";
  }

  return "Estoy con mucha demanda ahora mismo 😅. Probá en 1 minuto.";
}

// ======================
// GEMINI IMAGE (con retry 429)
// ======================
async function generateExerciseImageAndSaveWithRetry(imagePrompt, maxAttempts = 3) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: imagePrompt }] }] })
    });

    const data = await safeRead(response);

    if (response.ok && !data?.error) {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const inline = parts.find(p => p.inlineData?.data);
      const b64 = inline?.inlineData?.data;
      if (!b64) throw new Error("No inline image data returned");

      const buffer = Buffer.from(b64, "base64");
      const filename = `${crypto.randomBytes(12).toString("hex")}.png`;
      fs.writeFileSync(path.join(GENERATED_DIR, filename), buffer);
      return filename;
    }

    const code = data?.error?.code || response.status;
    if (code === 429 && attempt < maxAttempts) {
      const retryS = extractRetryDelaySeconds(data?.error) ?? (20 * attempt);
      console.error("❌ Gemini image 429:", data?.error?.message || data, "| retry in", retryS, "s");
      await sleep((retryS + 1) * 1000);
      continue;
    }

    // Si sigue apareciendo preview-image por env, lo vas a ver acá:
    console.error("❌ Gemini image error:", data?.error || data, "| model:", GEMINI_IMAGE_MODEL);
    throw new Error(data?.error?.message || `Image gen failed (${response.status})`);
  }

  throw new Error("Image gen exhausted retries");
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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });

  if (!r.ok) console.error("❌ sendText:", r.status, await safeRead(r));
}

async function sendImage(to, imageUrl, caption) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption }
    })
  });

  if (!r.ok) console.error("❌ sendImage:", r.status, await safeRead(r));
}

async function sendLongText(to, text, chunkSize = 3500) {
  const clean = (text || "").trim();
  if (!clean) return;

  if (clean.length <= chunkSize) {
    await sendText(to, clean);
    return;
  }

  for (let i = 0; i < clean.length; i += chunkSize) {
    await sendText(to, clean.slice(i, i + chunkSize));
  }
}

async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

// ======================
// START
// ======================
const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server on port ${port}`);
  console.log("✅ Public base URL:", PUBLIC_BASE_URL);
  console.log("✅ Models:", { GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL });
});
