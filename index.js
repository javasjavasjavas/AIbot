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

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://aibot-hsjq.onrender.com";

// Modelos
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

// Opcional: imágenes informativas (URLs públicas)
const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";

// ======================
// STORAGE IMÁGENES GENERADAS
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// Servimos imágenes generadas
app.use("/img", express.static(GENERATED_DIR));

// ======================
// ROUTES DE TEST (para que no salga Cannot GET /)
// ======================
app.get("/", (req, res) => {
  res.send("✅ Gym Coach Bot ONLINE (GET / OK)");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    webhook: "/webhook",
    publicBaseUrl: PUBLIC_BASE_URL,
    env: {
      hasVerifyToken: !!VERIFY_TOKEN,
      hasWhatsappToken: !!WHATSAPP_TOKEN,
      hasPhoneNumberId: !!PHONE_NUMBER_ID,
      hasGeminiKey: !!GEMINI_API_KEY
    },
    models: {
      text: GEMINI_TEXT_MODEL,
      image: GEMINI_IMAGE_MODEL
    }
  });
});

// ======================
// HELPERS GYM
// ======================
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
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
Create a clean instructional fitness illustration showing correct execution of:
"${exerciseQuery}"

Style:
- White background
- Two-panel layout: Start position and End position
- Neutral gym clothing, no logos
- Correct posture, alignment, range of motion
- No text, no labels, no watermark
`;
}

// ======================
// WEBHOOK VERIFY (GET) YA DEFINIDO ARRIBA
// ======================

// ======================
// WEBHOOK POST
// ======================
app.post("/webhook", async (req, res) => {
  // Responder rápido a Meta
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;

    // Log para saber si llegan eventos
    console.log("📥 Webhook value:", JSON.stringify(value || {}, null, 2));

    if (!value?.messages?.length) return;

    const message = value.messages[0];

    // waId correcto
    let waId = value?.contacts?.[0]?.wa_id || message.from;

    // Corrección Argentina 549 -> 54
    if (waId?.startsWith("549")) waId = "54" + waId.substring(3);

    const text = message?.text?.body || "";
    if (!text.trim()) return;

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
      const explanation = await askGeminiText(buildCoachPrompt(text));
      await sendLongText(waId, explanation);

      try {
        await sendText(waId, "🖼️ Generando imagen técnica...");
        const filename = await generateExerciseImageAndSave(buildExerciseImagePrompt(text));
        const imgUrl = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/img/${filename}`;
        await sendImage(waId, imgUrl, "✅ Ejecución correcta (referencia)");
      } catch (e) {
        console.error("❌ Imagen falló:", e?.message || e);
        await sendText(waId, "Pude explicarte el ejercicio, pero la imagen falló (cuota/modelo). Probá más tarde.");
      }
      return;
    }

    // DEFAULT
    const fallback = await askGeminiText(
      `Sos un asistente de gimnasio. Responde en español, claro y útil.\nUsuario: ${text}`
    );
    await sendLongText(waId, fallback);

  } catch (err) {
    console.error("❌ Error webhook:", err);
  }
});

// ======================
// GEMINI TEXT
// ======================
async function askGeminiText(prompt) {
  if (!GEMINI_API_KEY) return "⚠️ Falta GEMINI_API_KEY en Render.";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1200, topP: 0.9 }
    })
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    console.error("❌ Gemini text error:", data?.error || response.status);
    return "Tuve un problema al responder 😅. Probá de nuevo.";
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No pude generar respuesta.";
}

// ======================
// GEMINI IMAGE -> guardar PNG
// ======================
async function generateExerciseImageAndSave(imagePrompt) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }]
    })
  });

  const data = await response.json();

  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Image gen failed (${response.status})`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find(p => p.inlineData?.data);
  const b64 = inline?.inlineData?.data;

  if (!b64) throw new Error("No inline image data returned");

  const buffer = Buffer.from(b64, "base64");
  const filename = `${crypto.randomBytes(12).toString("hex")}.png`;
  fs.writeFileSync(path.join(GENERATED_DIR, filename), buffer);

  return filename;
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
app.listen(port, "0.0.0.0", () => console.log(`🚀 Server on port ${port}`));
