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

// Forzar no-preview
const ENV_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "";
const GEMINI_IMAGE_MODEL = ENV_IMAGE_MODEL.toLowerCase().includes("preview")
  ? "gemini-2.5-flash-image"
  : (ENV_IMAGE_MODEL || "gemini-2.5-flash-image");

// Opcionales
const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";

// Logs: info | debug | quiet
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// ======================
// MEMORY (RAM)
// ======================
// Guarda el último ejercicio por usuario. OJO: en Render free puede reiniciarse.
// Para persistente, luego lo pasamos a Redis/Supabase.
const lastExerciseByUser = new Map(); // waId -> string

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
// LOG HELPERS
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

// ======================
// GENERAL HELPERS
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

// Quita markdown pesado que WhatsApp “rompe”
function whatsappSafeText(text) {
  return (text || "")
    .replace(/###/g, "")        // headings
    .replace(/\*\*/g, "*")      // bold doble
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Split por párrafos y oraciones (más estable que por chars)
function splitForWhatsApp(text, maxLen = 2600) {
  const t = whatsappSafeText(text);
  if (t.length <= maxLen) return [t];

  const paragraphs = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const parts = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };

  for (const p of paragraphs) {
    // si un párrafo solo ya es enorme, lo partimos por oraciones
    if (p.length > maxLen) {
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((current + " " + s).trim().length > maxLen) pushCurrent();
        current = (current ? current + " " : "") + s;
      }
      pushCurrent();
      continue;
    }

    // caso normal: unir párrafos hasta maxLen
    const candidate = (current ? current + "\n\n" : "") + p;
    if (candidate.length > maxLen) {
      pushCurrent();
      current = p;
    } else {
      current = candidate;
    }
  }

  pushCurrent();
  return parts.length ? parts : [t.slice(0, maxLen)];
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

async function sendLongText(to, text) {
  const chunks = splitForWhatsApp(text, 2600);
  if (chunks.length === 1) {
    await sendText(to, chunks[0]);
    return;
  }
  for (let i = 0; i < chunks.length; i++) {
    await sendText(to, `(${i + 1}/${chunks.length}) ${chunks[i]}`);
  }
}

// ======================
// INTENTS
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
    "Planes disponibles:\n\n" +
    "Plan Black — $42.990/mes\n" +
    "- 12 meses de fidelidad\n- Inscripción gratis\n- Peso libre + cardio + clases\n- Acceso LatAm\n- App\n- 5 pases/mes\n- Sillones de masaje\n\n" +
    "Plan Fit — $34.990/mes\n" +
    "- 12 meses de fidelidad\n- Inscripción gratis\n- Peso libre + cardio + clases\n- App\n\n" +
    "Plan Smart — $39.990/mes\n" +
    "- Sin fidelidad\n- Inscripción gratis\n- Peso libre + cardio + clases\n- App\n- Sin permanencia mínima\n"
  );
}

function isAskingClasses(text) {
  const t = normalizeText(text);
  return t.includes("clase") || t.includes("clases") || t.includes("horario") || t.includes("horarios");
}

const EXERCISE_KEYWORDS = [
  "press banca", "press de banca", "press pecho", "press militar",
  "sentadilla", "peso muerto", "dominadas", "remo", "curl",
  "hip thrust", "plancha",
  "vuelos laterales", "elevaciones laterales", "elevacion lateral", "laterales",
  "hombros", "abdominales", "zancadas", "estocadas", "gemelos"
];

function wantsImage(text) {
  const t = normalizeText(text);
  return t.includes("imagen") || t.includes("foto") || t.includes("descriptiva") || t.includes("grafico") || t.includes("gráfico");
}

function isExerciseIntent(text) {
  const t = normalizeText(text);
  if (EXERCISE_KEYWORDS.some(k => t.includes(normalizeText(k)))) return true;

  const howTo = t.includes("como") || t.includes("cómo");
  const doIt = t.includes("hacer") || t.includes("se hace") || t.includes("realizar");
  const bodyParts = ["hombro", "pecho", "espalda", "pierna", "biceps", "bíceps", "triceps", "tríceps", "gluteo", "glúteo", "abdomen", "core"];
  const mentionsBody = bodyParts.some(b => t.includes(normalizeText(b)));

  if ((howTo && doIt) && mentionsBody) return true;
  return false;
}

// ======================
// PROMPTS (WhatsApp-friendly)
// ======================
function buildCoachPrompt(userText) {
  return `
Actúa como entrenador personal.
Responde en español, claro, práctico y sin markdown (sin ###).

El usuario pregunta: "${userText}"

Formato de respuesta:
- Qué trabaja (principal y secundarios)
- Técnica paso a paso (1 a 6)
- Errores comunes (5) + corrección
- Respiración y ritmo
- Variantes (principiante/intermedio/avanzado)
- Seguridad (cuándo parar)
- Mini rutina ejemplo

No digas que no puedes mostrar imágenes.
`;
}

function buildExerciseImagePrompt(exerciseQuery) {
  return `
Ilustración técnica instructiva del ejercicio: "${exerciseQuery}"

REQUISITOS:
- Fondo blanco puro.
- Estilo ilustración limpia tipo manual.
- Sin texto, sin letras, sin números, sin etiquetas.
- Dos paneles verticales separados por línea fina.
- Misma persona, mismo ángulo, coherente.
- Técnica correcta y segura, alineación articular correcta.
- Evitar errores típicos.

El panel 1 muestra una posición inicial estable.
El panel 2 muestra la posición de mayor recorrido/contracción correcta.

NO TEXTO. NO INGLÉS.
`;
}

// ======================
// GEMINI TEXT
// ======================
async function askGeminiTextWithRetry(prompt, maxAttempts = 3) {
  if (!GEMINI_API_KEY) return "Falta configurar GEMINI_API_KEY en el servidor.";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1400, // largo pero controlado
          topP: 0.9
        }
      })
    });

    const data = await safeRead(response);

    if (response.ok && !data?.error) {
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No pude generar una respuesta clara.";
    }

    const code = data?.error?.code || response.status;
    if (code === 429 && attempt < maxAttempts) {
      const retryS = extractRetryDelaySeconds(data?.error) ?? (8 * attempt);
      logError("⚠️ Gemini 429 (texto). Reintento en", retryS, "s");
      await sleep((retryS + 1) * 1000);
      continue;
    }

    logError("❌ Gemini text error:", code, data?.error?.message || data);
    return "Tuve un problema al responder. Probá de nuevo en un momento.";
  }

  return "Estoy con mucha demanda ahora. Probá en un minuto.";
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
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }]
    })
  });

  const data = await safeRead(response);

  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Image gen failed (${response.status})`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p) => p.inlineData?.data);
  const b64 = inline?.inlineData?.data;
  if (!b64) throw new Error("No inline image data returned");

  const buffer = Buffer.from(b64, "base64");
  const filename = `${crypto.randomBytes(12).toString("hex")}.png`;
  fs.writeFileSync(path.join(GENERATED_DIR, filename), buffer);

  return filename;
}

// ======================
// WEBHOOK VERIFY
// ======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logInfo("✅ Webhook verificado OK");
    return res.status(200).send(challenge);
  }
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

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;

    // Argentina 549 -> 54
    if (waId?.startsWith("549")) waId = "54" + waId.substring(3);

    const text = message?.text?.body || "";
    if (!text.trim()) return;

    logInfo(`📩 ${waId}: ${text}`);

    // 1) PRECIOS
    if (isAskingPrices(text)) {
      await sendLongText(waId, formatPlansText());
      if (PLANS_IMAGE_URL) await sendImage(waId, PLANS_IMAGE_URL, "Planes disponibles");
      return;
    }

    // 2) CLASES
    if (isAskingClasses(text)) {
      await sendText(waId, "Decime qué clase te interesa (Funcional / Zumba / etc.) y te paso días y horarios.");
      if (CLASSES_IMAGE_URL) await sendImage(waId, CLASSES_IMAGE_URL, "Grilla de clases");
      return;
    }

    // 3) SI PIDE IMAGEN PERO NO DICE EJERCICIO → usar último
    if (wantsImage(text) && !isExerciseIntent(text)) {
      const last = lastExerciseByUser.get(waId);
      if (!last) {
        await sendText(waId, "Dale. Decime el ejercicio exacto (por ejemplo: 'vuelos laterales') y te genero la imagen.");
        return;
      }

      try {
        await sendText(waId, `Perfecto. Genero la imagen de: ${last}`);
        const filename = await generateExerciseImageAndSave(buildExerciseImagePrompt(last));
        const imgUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
        logInfo("🖼️ Image URL:", imgUrl);
        await sendImage(waId, imgUrl, "Ejecución correcta (referencia)");
      } catch (e) {
        logError("❌ Error generando imagen:", e?.message || e);
        await sendText(waId, "La imagen falló. Probá de nuevo en 1 minuto.");
      }
      return;
    }

    // 4) EJERCICIOS
    if (isExerciseIntent(text)) {
      // Guardar memoria del último ejercicio (texto original para mejor contexto)
      lastExerciseByUser.set(waId, text);

      const explanation = await askGeminiTextWithRetry(buildCoachPrompt(text));
      await sendLongText(waId, explanation);

      if (wantsImage(text)) {
        try {
          await sendText(waId, "Generando imagen descriptiva...");
          const filename = await generateExerciseImageAndSave(buildExerciseImagePrompt(text));
          const imgUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
          logInfo("🖼️ Image URL:", imgUrl);
          await sendImage(waId, imgUrl, "Ejecución correcta (referencia)");
        } catch (e) {
          logError("❌ Error generando imagen:", e?.message || e);
          await sendText(waId, "Pude explicarte el ejercicio, pero la imagen falló. Probá de nuevo en 1 minuto.");
        }
      } else {
        // CTA: ofrecer imagen
        await sendText(waId, "Si querés, decime 'mostrame una imagen' y te genero una imagen descriptiva del ejercicio.");
      }

      return;
    }

    // 5) DEFAULT
    const reply = await askGeminiTextWithRetry(
      `Sos un asistente de gimnasio. Responde en español, claro y útil, sin markdown.\nUsuario: ${text}`
    );
    await sendLongText(waId, reply);

  } catch (err) {
    logError("❌ Error webhook:", err);
  }
});

// ======================
// START
// ======================
const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => {
  logInfo(`🚀 Server on port ${port}`);
  logInfo("✅ Public base URL:", PUBLIC_BASE_URL);
  logInfo("✅ Models:", { GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL });
});
