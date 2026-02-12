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

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// ======================
// MEMORY (RAM)
// ======================
const lastExerciseByUser = new Map();
const userState = new Map();

function getState(waId) {
  if (!userState.has(waId)) {
    userState.set(waId, {
      flow: "menu",
      nutritionStep: null,
      nutritionProfile: { gender: null, age: null, weightKg: null }
    });
  }
  return userState.get(waId);
}

function resetToMenu(waId) {
  userState.set(waId, {
    flow: "menu",
    nutritionStep: null,
    nutritionProfile: { gender: null, age: null, weightKg: null }
  });
}

// ======================
// STORAGE IMÁGENES
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
app.use("/img", express.static(GENERATED_DIR));

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

function whatsappSafeText(text) {
  return (text || "")
    .replace(/###/g, "")
    .replace(/\*\*/g, "*")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function splitForWhatsApp(text, maxLen = 2600) {
  const t = whatsappSafeText(text);
  if (t.length <= maxLen) return [t];

  const parts = [];
  let current = "";

  const paragraphs = t.split(/\n\s*\n/);

  for (const p of paragraphs) {
    if ((current + p).length > maxLen) {
      parts.push(current);
      current = p;
    } else {
      current += "\n\n" + p;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function sendText(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  await fetch(url, {
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
}

async function sendLongText(to, text) {
  const chunks = splitForWhatsApp(text);
  for (let i = 0; i < chunks.length; i++) {
    await sendText(to, chunks.length > 1 ? `(${i + 1}/${chunks.length}) ${chunks[i]}` : chunks[i]);
  }
}

// ======================
// INTENTS
// ======================
function isMenuCommand(text) {
  const t = normalizeText(text);
  return t === "menu" || t === "menú" || t === "inicio";
}

function isNutritionIntent(text) {
  const t = normalizeText(text);

  const phrases = [
    "bajar de peso", "perder peso", "bajar grasa",
    "dieta", "calorias", "calorías",
    "macros", "proteina", "proteína",
    "volumen", "definicion", "definición",
    "masa muscular", "ganar musculo"
  ];

  if (phrases.some(p => t.includes(p))) return true;

  if (t.includes("quiero") && (t.includes("bajar") || t.includes("definir") || t.includes("volumen")))
    return true;

  return false;
}

function isExerciseIntent(text) {
  const t = normalizeText(text);
  return t.includes("press") ||
    t.includes("sentadilla") ||
    t.includes("peso muerto") ||
    t.includes("dominadas") ||
    t.includes("remo") ||
    t.includes("curl");
}

// ======================
// PROMPTS
// ======================
function buildCoachPrompt(userText) {
  return `
Actúa como entrenador personal.
Responde en español claro, sin markdown.

Usuario: "${userText}"

Incluye:
- Qué trabaja
- Técnica paso a paso
- Errores comunes
- Mini rutina ejemplo
`;
}

function buildNutritionPrompt(userText, profile) {
  return `
Actúa como nutricionista deportivo.
Responde en español claro, sin markdown.

Datos:
Genero: ${profile.gender}
Edad: ${profile.age}
Peso: ${profile.weightKg} kg

Usuario pregunta: "${userText}"

Incluye:
- Recomendación clara
- Rangos orientativos
- Ejemplo práctico
- Advertencia de seguridad
`;
}

// ======================
// GEMINI TEXT
// ======================
async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1200 }
    })
  });

  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "No pude generar respuesta.";
}

// ======================
// WEBHOOK
// ======================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.length) return;

    const message = value.messages[0];
    const waId = message.from;
    const text = message?.text?.body || "";
    if (!text.trim()) return;

    const state = getState(waId);

    // MENU COMMAND
    if (isMenuCommand(text)) {
      resetToMenu(waId);
      await sendText(waId, "¿Querés información de Gimnasio o Nutrición?");
      return;
    }

    // MENU FLOW
    if (state.flow === "menu") {

      if (isNutritionIntent(text)) {
        state.flow = "nutrition";
        state.nutritionStep = "gender";
        await sendText(waId, "1/3 ¿Tu género?");
        return;
      }

      state.flow = "gym";
    }

    // ======================
    // NUTRITION FLOW
    // ======================
    if (state.flow === "nutrition") {

      if (state.nutritionStep === "gender") {
        state.nutritionProfile.gender = text;
        state.nutritionStep = "age";
        await sendText(waId, "2/3 ¿Edad?");
        return;
      }

      if (state.nutritionStep === "age") {
        state.nutritionProfile.age = text;
        state.nutritionStep = "weight";
        await sendText(waId, "3/3 ¿Peso en kg?");
        return;
      }

      if (state.nutritionStep === "weight") {
        state.nutritionProfile.weightKg = text;
        state.nutritionStep = "done";
        await sendText(waId, "Perfecto. Ahora preguntame lo que quieras sobre nutrición.");
        return;
      }

      const reply = await askGemini(buildNutritionPrompt(text, state.nutritionProfile));
      await sendLongText(waId, reply);
      return;
    }

    // ======================
    // GYM FLOW
    // ======================
    if (isExerciseIntent(text)) {
      lastExerciseByUser.set(waId, text);
      const reply = await askGemini(buildCoachPrompt(text));
      await sendLongText(waId, reply);
      return;
    }

    // DEFAULT
    const reply = await askGemini(`Sos asistente de gimnasio. Responde claro.\nUsuario: ${text}`);
    await sendLongText(waId, reply);

  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ======================
app.listen(process.env.PORT || 1000, () => {
  console.log("🚀 Bot online");
});
