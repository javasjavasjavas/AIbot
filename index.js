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

// Forzar que NO sea preview
const ENV_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "";
const GEMINI_IMAGE_MODEL = ENV_IMAGE_MODEL.toLowerCase().includes("preview")
  ? "gemini-2.5-flash-image"
  : (ENV_IMAGE_MODEL || "gemini-2.5-flash-image");

// Opcionales (si querés mandar tus imágenes de planes/clases)
const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";

// Logs
const LOG_LEVEL = process.env.LOG_LEVEL || "info"; // info | debug | quiet

// ======================
// STORAGE IMÁGENES
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
app.use("/img", express.static(GENERATED_DIR));

// ======================
// ROUTES
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
function logInfo(...args) {
  if (LOG_LEVEL === "quiet") return;
  console.log(...args);
}
function logDebug(...args) {
  if (LOG_LEVEL !== "debug") return;
  console.log(...args);
}
function logError(...args) {
  console.error(...args);
}

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

async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

function extractRetryDelaySeconds(errObj) {
  try {
    const details = errObj?.details;
    if (!Array.isArray(details)) return null;
    const retryInfo = details.find((d) => d["@type"]?.includes("RetryInfo"));
    const s = retryInfo?.retryDelay;
    if (!s) return null;
    if (typeof s === "string" && s.endsWith("s")) return Number(s.replace("s", ""));
    return null;
  } catch {
    return null;
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
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });

  if (!r.ok) {
    const body = await safeRead(r);
    logError("❌ sendText failed:", r.status, body);
  }
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

  if (!r.ok) {
    const body = await safeRead(r);
    logError("❌ sendImage failed:", r.status, body, "URL:", imageUrl);
  }
}

/**
 * WhatsApp corta alrededor de 4096 chars.
 * Usamos margen y numeramos partes para que el usuario entienda continuidad.
 */
async function sendLongText(to, text, chunkSize = 2800) {
  const clean = (text || "").trim();
  if (!clean) return;

  if (clean.length <= chunkSize) {
    await sendText(to, clean);
    return;
  }

  const chunks = [];
  for (let i = 0; i < clean.length; i += chunkSize) chunks.push(clean.slice(i, i + chunkSize));

  for (let idx = 0; idx < chunks.length; idx++) {
    const header = `(${idx + 1}/${chunks.length}) `;
    await sendText(to, header + chunks[idx]);
  }
}

// ======================
// INTENTS: PRECIOS / CLASES / EJERCICIOS
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

// Si querés, después lo conectamos con tu grilla real
function isAskingClasses(text) {
  const t = normalizeText(text);
  return t.includes("clase") || t.includes("clases") || t.includes("horario") || t.includes("horarios");
}

// ✅ Esto arregla el caso “vuelos laterales”: no estaba en tu lista
const EXERCISE_KEYWORDS = [
  "press banca", "press de banca", "press pecho", "press militar",
  "sentadilla", "peso muerto", "dominadas", "remo", "curl",
  "hip thrust", "plancha", "vuelos laterales", "elevaciones laterales",
  "elevacion lateral", "elevaciones laterales", "laterales", "hombros",
  "abdominales", "zancadas", "estocadas", "gemelos"
];

function wantsImage(text) {
  const t = normalizeText(text);
  return t.includes("imagen") || t.includes("foto") || t.includes("grafico") || t.includes("gráfico") || t.includes("descriptiva");
}

/**
 * Intención ejercicio:
 * - si contiene keywords de ejercicio, o
 * - si pregunta “cómo hacer” + algo del gimnasio, o
 * - si pide “imagen” y menciona una parte del cuerpo común
 */
function isExerciseIntent(text) {
  const t = normalizeText(text);
  if (EXERCISE_KEYWORDS.some(k => t.includes(normalizeText(k)))) return true;

  const howTo = t.includes("como") || t.includes("cómo");
  const doIt = t.includes("hacer") || t.includes("se hace") || t.includes("realizar");
  const bodyParts = ["hombro", "pecho", "espalda", "pierna", "biceps", "bíceps", "triceps", "tríceps", "gluteo", "glúteo", "abdomen", "core"];
  const mentionsBody = bodyParts.some(b => t.includes(normalizeText(b)));

  if ((howTo && doIt) && mentionsBody) return true;
  if (wantsImage(text) && mentionsBody) return true;

  return false;
}

// ======================
// PROMPTS
// ======================
function buildCoachPrompt(userText) {
  return `
Actúa como PROFESOR/A DE GIMNASIO (entrenador personal).
Responde en español, claro, amable y profesional.

El usuario pregunta: "${userText}"

Estructura obligatoria:
1) Qué trabaja (músculos principales y secundarios).
2) Técnica paso a paso (lista numerada).
3) 5 errores comunes y cómo corregirlos.
4) Respiración y ritmo.
5) Variantes (principiante / intermedio / avanzado).
6) Consejos de seguridad (cuándo parar).
7) Ejemplo de rutina corta.

IMPORTANTE:
- NO digas que “no puedes mostrar imágenes”.
- Si el usuario pide imagen, asumí que se generará aparte.
`;
}

/**
 * Prompt universal sin hardcode por ejercicio:
 * - Sin texto (para evitar inglés)
 * - Dos paneles
 * - “interpretar” el movimiento y elegir dos fases clave
 */
function buildExerciseImagePrompt(exerciseQuery) {
  return `
Ilustración técnica instructiva del ejercicio: "${exerciseQuery}"

REQUISITOS VISUALES:
- Fondo completamente blanco.
- Estilo ilustración limpia tipo manual de entrenamiento.
- Sin texto, sin títulos, sin etiquetas, sin letras, sin números (prohibido).
- Sin marcas de agua ni logos.
- Dos paneles apilados verticalmente separados por una línea fina.
- Misma persona, mismo ángulo de cámara, misma distancia, ambos paneles coherentes.

INTERPRETACIÓN DEL MOVIMIENTO:
1) Analiza el ejercicio y determina automáticamente:
   - Una posición inicial estable y segura.
   - Una posición de mayor recorrido (máxima flexión / máxima contracción) correcta.
2) Respeta técnica estándar de gimnasio:
   - Alineación articular correcta.
   - Muñecas neutras alineadas con antebrazos.
   - Columna neutra/segura según el ejercicio.
   - Escápulas/torso/pies correctamente colocados si aplica.
3) Evita errores típicos del ejercicio.

NO TEXTO. NO INGLÉS. NO ETIQUETAS.
`;
}

// ======================
// GEMINI TEXT (retry básico)
// ======================
async function askGeminiTextWithRetry(prompt, maxAttempts = 3) {
  if (!GEMINI_API_KEY) return "⚠️ Falta GEMINI_API_KEY en el servidor.";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1800, // más largo
          topP: 0.9
        }
      })
    });

    const data = await safeRead(response);

    if (response.ok && !data?.error) {
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return out || "No pude generar una respuesta clara.";
    }

    const code = data?.error?.code || response.status;
    if (code === 429 && attempt < maxAttempts) {
      const retryS = extractRetryDelaySeconds(data?.error) ?? (8 * attempt);
      logError("⚠️ Gemini 429 (texto). Reintento en", retryS, "s");
      await sleep((retryS + 1) * 1000);
      continue;
    }

    logError("❌ Gemini text error:", code, data?.error?.message || data);
    return "Tuve un problema al responder 😅. Probá de nuevo en un momento.";
  }

  return "Estoy con mucha demanda ahora 😅. Probá en un minuto.";
}

// ======================
// GEMINI IMAGE
// ======================
async function generateExerciseImageAndSave(imagePrompt) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: image]()]()
