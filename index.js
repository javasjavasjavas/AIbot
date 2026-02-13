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
const lastExerciseByUser = new Map(); // waId -> string

// Estado conversación
// flow: menu | gym | nutrition
// nutritionStep:
// objective | base_weight | base_height | base_age | base_sex | base_anthro | base_bf | analysis | done
const userState = new Map(); // waId -> { flow, nutritionStep, nutritionProfile }

function getState(waId) {
  if (!userState.has(waId)) {
    userState.set(waId, {
      flow: "menu",
      nutritionStep: null,
      nutritionProfile: {
        objective: null, // A/B/C/D/E
        weightKg: null,
        heightCm: null,
        age: null,
        sex: null,
        lastAnthro: null, // texto libre / fecha
        bodyFatPercent: null, // número opcional
        analysisNotes: null, // respuestas a análisis
        flags: { suggestAnthroIn7Days: false, riskReferral: false }
      }
    });
  }
  return userState.get(waId);
}

function resetToMenu(waId) {
  userState.set(waId, {
    flow: "menu",
    nutritionStep: null,
    nutritionProfile: {
      objective: null,
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
      lastAnthro: null,
      bodyFatPercent: null,
      analysisNotes: null,
      flags: { suggestAnthroIn7Days: false, riskReferral: false }
    }
  });
}

// ======================
// STORAGE IMÁGENES
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
app.use("/img", express.static(GENERATED_DIR));

// ======================
// NUTRICIÓN SYSTEM PROMPT (root)
// ======================
const NUTRITION_SYSTEM_PATH = path.join(process.cwd(), "nutricion-system.md");
let NUTRITION_SYSTEM_PROMPT = "";

function loadNutritionSystemPrompt() {
  try {
    if (!fs.existsSync(NUTRITION_SYSTEM_PATH)) {
      NUTRITION_SYSTEM_PROMPT = "";
      logError("❌ No se encontró nutricion-system.md en:", NUTRITION_SYSTEM_PATH);
      return;
    }
    NUTRITION_SYSTEM_PROMPT = fs.readFileSync(NUTRITION_SYSTEM_PATH, "utf-8").trim();
    NUTRITION_SYSTEM_PROMPT = NUTRITION_SYSTEM_PROMPT.replace(/InBody/gi, "Antropometría");
    logInfo("🧠 nutricion-system.md cargado OK. chars:", NUTRITION_SYSTEM_PROMPT.length);
  } catch (e) {
    NUTRITION_SYSTEM_PROMPT = "";
    logError("❌ Error cargando nutricion-system.md:", e?.message || e);
  }
}

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
    },
    nutritionSystem: {
      loaded: !!NUTRITION_SYSTEM_PROMPT,
      chars: NUTRITION_SYSTEM_PROMPT.length,
      path: NUTRITION_SYSTEM_PATH
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
    .replace(/###/g, "")
    .replace(/\*\*/g, "*")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function splitForWhatsApp(text, maxLen = 1800) {
  // 👈 bajamos a 1800 para más margen y menos “recortes raros” de WhatsApp/cliente
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
    if (p.length > maxLen) {
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((current + " " + s).trim().length > maxLen) pushCurrent();
        current = (current ? current + " " : "") + s;
      }
      pushCurrent();
      continue;
    }

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
  const chunks = splitForWhatsApp(text, 1800);
  if (chunks.length === 1) {
    await sendText(to, chunks[0]);
    return;
  }
  for (let i = 0; i < chunks.length; i++) {
    await sendText(to, `(${i + 1}/${chunks.length}) ${chunks[i]}`);
  }
}

// ======================
// INTENTS GYM
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

function isGymIntent(text) {
  return isAskingPrices(text) || isAskingClasses(text) || isExerciseIntent(text) || wantsImage(text);
}

// ======================
// MENU + NUTRITION INTENTS
// ======================
function isMenuCommand(text) {
  const t = normalizeText(text);
  return (
    t === "menu" ||
    t === "menú" ||
    t === "inicio" ||
    t === "start" ||
    t.includes("volver al menu") ||
    t.includes("volver al menu principal") ||
    t.includes("menu principal")
  );
}

function formatMenuText() {
  return (
    "Hola! 👋\n" +
    "¿Qué querés ver hoy?\n\n" +
    "1) Gimnasio (clases, precios, ejercicios)\n" +
    "2) Nutrición (onboarding + plan de hábitos)\n\n" +
    "Respondé: 'gimnasio' o 'nutrición'.\n" +
    "Tip: escribí 'volver al menu principal' cuando quieras volver."
  );
}

function isNutritionIntent(text) {
  const t = normalizeText(text);

  const strong = [
    "nutricion", "nutrición", "dieta", "comida", "alimentacion", "alimentación",
    "bajar de peso", "perder peso", "bajar grasa", "perder grasa", "definicion", "definición",
    "macros", "calorias", "calorías", "proteina", "proteína", "carbohidratos",
    "volumen", "ganar musculo", "ganar músculo", "rendimiento", "hidratacion", "hidratación"
  ];

  if (strong.some(p => t.includes(p))) return true;

  const wants = t.includes("quiero") || t.includes("necesito") || t.includes("me gustaria") || t.includes("me gustaría");
  const goals = ["bajar", "perder", "definir", "marcar", "volumen", "musculo", "músculo", "rendimiento", "salud"];
  if (wants && goals.some(g => t.includes(g))) return true;

  return false;
}

// ======================
// PARSERS ONBOARDING NUTRICIÓN
// ======================
function parseObjective(text) {
  const t = normalizeText(text);

  if (["a", "b", "c", "d", "e"].includes(t)) return t.toUpperCase();

  if (t.includes("grasa") || t.includes("bajar") || t.includes("perder peso") || t.includes("definir") || t.includes("marcar")) return "A";
  if (t.includes("masa") || t.includes("musculo") || t.includes("músculo") || t.includes("volumen") || t.includes("bulk")) return "B";
  if (t.includes("recompos") || (t.includes("bajar") && (t.includes("musculo") || t.includes("músculo")))) return "C";
  if (t.includes("rendimiento") || t.includes("performance") || t.includes("mejorar tiempos") || t.includes("energia") || t.includes("energía")) return "D";
  if (t.includes("salud") || t.includes("bienestar") || t.includes("habitos") || t.includes("hábitos")) return "E";

  return null;
}

function parseWeightKg(text) {
  const t = normalizeText(text).replace(",", ".");
  const m = t.match(/(\d{2,3}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const w = Number(m[1]);
  if (!Number.isFinite(w) || w < 30 || w > 250) return null;
  return w;
}

function parseHeightCm(text) {
  const t = normalizeText(text).replace(",", ".");
  const m = t.match(/(\d{1,3}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;

  if (n >= 1.2 && n <= 2.3) return Math.round(n * 100);
  if (n >= 120 && n <= 230) return Math.round(n);
  return null;
}

function parseAge(text) {
  const t = normalizeText(text);
  const m = t.match(/(\d{1,3})/);
  if (!m) return null;
  const age = Number(m[1]);
  if (!Number.isFinite(age) || age < 10 || age > 100) return null;
  return age;
}

function parseSex(text) {
  const t = normalizeText(text);
  if (t.includes("hombre") || t.includes("masculino") || t === "m" || t.includes("varon") || t.includes("varón")) return "masculino";
  if (t.includes("mujer") || t.includes("femenino") || t === "f") return "femenino";
  if (t.includes("no bin") || t.includes("nobin") || t.includes("no-bin") || t.includes("nb")) return "no_binario";
  if (t.includes("prefiero") || t.includes("no decir") || t.includes("no quiero")) return "no_especifica";
  return null;
}

function parseBodyFatPercent(text) {
  const t = normalizeText(text).replace(",", ".");
  const m = t.match(/(\d{1,2}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const bf = Number(m[1]);
  if (!Number.isFinite(bf) || bf < 3 || bf > 60) return null;
  return bf;
}

function saysNoAnthro(text) {
  const t = normalizeText(text);
  return t.includes("no") && (t.includes("antrop") || t.includes("nunca") || t.includes("no tengo"));
}

function objectiveLabel(obj) {
  switch (obj) {
    case "A": return "Pérdida de grasa";
    case "B": return "Ganancia muscular";
    case "C": return "Recomposición corporal";
    case "D": return "Rendimiento";
    case "E": return "Salud general";
    default: return "No definido";
  }
}

// ======================
// PROMPTS
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

function buildNutritionJsonPlanPrompt(profile) {
  const sys = (NUTRITION_SYSTEM_PROMPT || "").trim();

  return `
${sys}

Contexto del usuario (onboarding F45):
- Objetivo: ${profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido"}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- % grasa (si sabe): ${profile.bodyFatPercent ?? "N/A"}
- Respuestas análisis nutricional: ${profile.analysisNotes ?? "N/A"}
- Flag sugerir Antropometría en 7 días: ${profile.flags?.suggestAnthroIn7Days ? "SI" : "NO"}

Tarea:
Genera un plan inicial para 7 días.

Salida:
DEVOLVÉ SOLO JSON VÁLIDO, sin texto extra, sin markdown, sin comentarios.
Si no sabés algo, poné null o string vacío.

Esquema JSON:
{
  "diagnostico_breve": "string (2-3 líneas máximo)",
  "micro_ajustes": ["string", "string", "string", "string", "string", "string"],
  "timing_entreno": ["string", "string"],
  "hidratacion": ["string", "string"],
  "accion_semana": "string (1 línea)",
  "recordatorio_f45": "string (1-2 líneas)",
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}

Reglas duras:
- NO te presentes. NO saludes.
- Todo debe ser corto y accionable.
- micro_ajustes: 3 a 6 ítems.
- timing_entreno: 1 a 2 ítems.
- hidratacion: 1 a 2 ítems.
`;
}

function formatPlanFromJson(obj) {
  const lines = [];
  const diag = obj?.diagnostico_breve || "";
  const micro = Array.isArray(obj?.micro_ajustes) ? obj.micro_ajustes.filter(Boolean) : [];
  const timing = Array.isArray(obj?.timing_entreno) ? obj.timing_entreno.filter(Boolean) : [];
  const hidr = Array.isArray(obj?.hidratacion) ? obj.hidratacion.filter(Boolean) : [];
  const accion = obj?.accion_semana || "";
  const f45 = obj?.recordatorio_f45 || "";
  const ant = obj?.sugerir_antropometria || "";
  const der = obj?.derivacion || "";

  if (diag) {
    lines.push("Diagnóstico breve:");
    lines.push(diag);
    lines.push("");
  }

  if (micro.length) {
    lines.push("Micro ajustes concretos:");
    for (const m of micro) lines.push(`- ${m}`);
    lines.push("");
  }

  if (timing.length) {
    lines.push("Timing alrededor del entrenamiento:");
    for (const t of timing) lines.push(`- ${t}`);
    lines.push("");
  }

  if (hidr.length) {
    lines.push("Hidratación:");
    for (const h of hidr) lines.push(`- ${h}`);
    lines.push("");
  }

  if (accion) {
    lines.push("Acción concreta para esta semana:");
    lines.push(accion);
    lines.push("");
  }

  if (f45) {
    lines.push("F45:");
    lines.push(f45);
    lines.push("");
  }

  if (ant) {
    lines.push("Antropometría:");
    lines.push(ant);
    lines.push("");
  }

  if (der) {
    lines.push("Derivación sugerida:");
    lines.push(der);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function tryParseJsonLoose(s) {
  if (!s) return null;
  const raw = s.trim();
  // a veces el modelo mete texto antes/después; intentamos recortar al primer { ... último }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = raw.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// ======================
// GEMINI TEXT (con retry)
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
          temperature: 0.4,
          maxOutputTokens: 900,
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

    // Volver al menú principal (en cualquier momento)
    if (isMenuCommand(text)) {
      resetToMenu(waId);
      await sendLongText(waId, formatMenuText());
      return;
    }

    const state = getState(waId);

    // ======================
    // MENU FLOW
    // ======================
    if (state.flow === "menu") {
      const t = normalizeText(text);

      if (isNutritionIntent(text) && !isExerciseIntent(text)) {
        state.flow = "nutrition";
        state.nutritionStep = "objective";
        userState.set(waId, state);
        await sendText(
          waId,
          "Perfecto. Arranquemos el onboarding nutricional F45.\n\nPaso 1: ¿Cuál es tu objetivo principal?\nA) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\nRespondé con la letra (A-E) o con una frase (ej: 'bajar grasa')."
        );
        return;
      }

      if (t.includes("gim") || isGymIntent(text)) {
        state.flow = "gym";
        userState.set(waId, state);
      } else {
        await sendLongText(waId, formatMenuText());
        return;
      }
    }

    // Si estaba en nutrition pero pregunta de gym
    if (state.flow === "nutrition" && isGymIntent(text) && !isNutritionIntent(text)) {
      state.flow = "gym";
      userState.set(waId, state);
    }

    // ======================
    // NUTRITION FLOW
    // ======================
    if (state.flow === "nutrition") {
      const step = state.nutritionStep;

      if (step === "objective") {
        const obj = parseObjective(text);
        if (!obj) {
          await sendText(
            waId,
            "Para ubicarte bien, decime tu objetivo principal:\nA) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\nPodés responder con A-E o con una frase (ej: 'ganar músculo')."
          );
          return;
        }
        state.nutritionProfile.objective = obj;
        state.nutritionStep = "base_weight";
        userState.set(waId, state);
        await sendText(waId, "Paso 2/2 (Datos base). Primero: ¿cuánto pesás en kg? (ej: 72 o 72.5)");
        return;
      }

      if (step === "base_weight") {
        const w = parseWeightKg(text);
        if (!w) {
          await sendText(waId, "No pude leer el peso. Pasame un número en kg (ej: 72 o 72.5).");
          return;
        }
        state.nutritionProfile.weightKg = w;
        state.nutritionStep = "base_height";
        userState.set(waId, state);
        await sendText(waId, "¿Tu altura? (podés poner 175 o 1.75)");
        return;
      }

      if (step === "base_height") {
        const h = parseHeightCm(text);
        if (!h) {
          await sendText(waId, "No pude leer la altura. Pasame 175 o 1.75.");
          return;
        }
        state.nutritionProfile.heightCm = h;
        state.nutritionStep = "base_age";
        userState.set(waId, state);
        await sendText(waId, "¿Edad? (solo número, ej: 29)");
        return;
      }

      if (step === "base_age") {
        const age = parseAge(text);
        if (!age) {
          await sendText(waId, "No pude leer la edad. Pasame un número entre 10 y 100 (ej: 29).");
          return;
        }
        state.nutritionProfile.age = age;
        state.nutritionStep = "base_sex";
        userState.set(waId, state);
        await sendText(waId, "¿Sexo? (masculino / femenino / no binario / prefiero no decir)");
        return;
      }

      if (step === "base_sex") {
        const sx = parseSex(text);
        if (!sx) {
          await sendText(waId, "Decime: masculino / femenino / no binario / prefiero no decir.");
          return;
        }
        state.nutritionProfile.sex = sx;
        state.nutritionStep = "base_anthro";
        userState.set(waId, state);
        await sendText(waId, "¿Cuándo fue tu última Antropometría? (ej: 'hace 3 semanas', 'enero 2026', o 'no tengo')");
        return;
      }

      if (step === "base_anthro") {
        state.nutritionProfile.lastAnthro = text.trim();
        if (saysNoAnthro(text)) state.nutritionProfile.flags.suggestAnthroIn7Days = true;
        state.nutritionStep = "base_bf";
        userState.set(waId, state);
        await sendText(waId, "¿Sabés tu % de grasa? (si no, respondé 'no')");
        return;
      }

      if (step === "base_bf") {
        const t = normalizeText(text);
        if (!(t === "no" || t === "nop" || t === "no se" || t === "no sé" || t === "nose")) {
          const bf = parseBodyFatPercent(text);
          if (!bf) {
            await sendText(waId, "Si lo sabés, pasame un número (ej: 18 o 22.5). Si no, respondé 'no'.");
            return;
          }
          state.nutritionProfile.bodyFatPercent = bf;
        }

        state.nutritionStep = "analysis";
        userState.set(waId, state);

        await sendText(
          waId,
          "Perfecto ✅ Onboarding completo.\n\nAhora, para afinar el plan, respondeme estas preguntas rápidas (en un solo mensaje si podés):\n" +
          "1) ¿Cuánta proteína dirías que comés por día? (baja/media/alta o ejemplos)\n" +
          "2) ¿Cuánta agua tomás por día?\n" +
          "3) ¿Alcohol? (nunca / 1-2 veces semana / más)\n" +
          "4) ¿Tenés hambre o picoteo nocturno?\n" +
          "5) ¿Cómo llegás al entrenamiento: con energía o sin energía?"
        );
        return;
      }

      // ✅ PLAN: pedimos JSON para evitar truncado raro, y lo formateamos nosotros
      if (step === "analysis") {
        state.nutritionProfile.analysisNotes = text.trim();
        state.nutritionStep = "done";
        userState.set(waId, state);

        await sendText(waId, "Genial. Con todo esto ya puedo armarte un plan de acción inicial para esta semana ✅");
        await sendText(waId, "Acá va tu plan inicial (7 días):");

        const raw = await askGeminiTextWithRetry(buildNutritionJsonPlanPrompt(state.nutritionProfile));
        const obj = tryParseJsonLoose(raw);

        if (!obj) {
          // fallback: mandamos el texto igual, pero avisamos
          logError("⚠️ No pude parsear JSON del plan. Raw:", raw?.slice(0, 300));
          await sendLongText(waId, raw);
          return;
        }

        const planText = formatPlanFromJson(obj);
        await sendLongText(waId, planText);
        return;
      }

      // done: preguntas nutrición (mantener simple; podés luego también pasarlo a JSON si querés)
      const reply = await askGeminiTextWithRetry(
        `
${NUTRITION_SYSTEM_PROMPT}

Reglas extra:
- No te presentes. No saludes.
- Responde claro, técnico y accionable.
- Hacé preguntas si faltan datos relevantes.
- Cerrar con UNA acción concreta para la semana.
- Sin markdown.

Contexto del usuario:
Objetivo: ${state.nutritionProfile.objective ? `${state.nutritionProfile.objective} (${objectiveLabel(state.nutritionProfile.objective)})` : "N/A"}
Peso: ${state.nutritionProfile.weightKg ?? "N/A"} kg
Altura: ${state.nutritionProfile.heightCm ?? "N/A"} cm
Edad: ${state.nutritionProfile.age ?? "N/A"}
Sexo: ${state.nutritionProfile.sex ?? "N/A"}
Última Antropometría: ${state.nutritionProfile.lastAnthro ?? "N/A"}
% grasa: ${state.nutritionProfile.bodyFatPercent ?? "N/A"}
Análisis: ${state.nutritionProfile.analysisNotes ?? "N/A"}

Usuario: "${text}"
        `.trim()
      );
      await sendLongText(waId, reply);
      return;
    }

    // ======================
    // GYM FLOW
    // ======================
    if (isAskingPrices(text)) {
      await sendLongText(waId, formatPlansText());
      if (PLANS_IMAGE_URL) await sendImage(waId, PLANS_IMAGE_URL, "Planes disponibles");
      return;
    }

    if (isAskingClasses(text)) {
      await sendText(waId, "Decime qué clase te interesa (Funcional / Zumba / etc.) y te paso días y horarios.");
      if (CLASSES_IMAGE_URL) await sendImage(waId, CLASSES_IMAGE_URL, "Grilla de clases");
      return;
    }

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

    if (isExerciseIntent(text)) {
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
        await sendText(waId, "Si querés, decime 'mostrame una imagen' y te genero una imagen descriptiva del ejercicio.");
      }

      return;
    }

    const defaultReply = await askGeminiTextWithRetry(
      `Sos un asistente de gimnasio. Responde en español, claro y útil, sin markdown.\nUsuario: ${text}`
    );
    await sendLongText(waId, defaultReply);

  } catch (err) {
    logError("❌ Error webhook:", err);
  }
});

// ======================
// START
// ======================
loadNutritionSystemPrompt();

const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => {
  logInfo(`🚀 Server on port ${port}`);
  logInfo("✅ Public base URL:", PUBLIC_BASE_URL);
  logInfo("✅ Models:", { GEMINI_TEXT_MODEL, GEMINI_IMAGE_MODEL });
  logInfo("✅ Nutrition system loaded:", !!NUTRITION_SYSTEM_PROMPT);
});
