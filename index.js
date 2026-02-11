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

// MODELOS CORRECTOS
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"; // 🔥 CAMBIO IMPORTANTE

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// ======================
// STORAGE IMÁGENES
// ======================
const GENERATED_DIR = path.join(process.cwd(), "generated");
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

app.use("/img", express.static(GENERATED_DIR));

// ======================
// MEMORIA RAM
// ======================
const memory = new Map();

function getSession(id) {
  if (!memory.has(id)) memory.set(id, { history: [] });
  return memory.get(id);
}

// ======================
// WEBHOOK VERIFY
// ======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
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
    const waId = value?.contacts?.[0]?.wa_id || message.from;
    const text = message?.text?.body || "";

    console.log("Mensaje de", waId, ":", text);

    if (!text.trim()) return;

    if (isExerciseQuery(text)) {
      await sendText(waId, "💪 Generando explicación técnica...");

      const explanation = await generateExerciseExplanation(text);
      await sendLongText(waId, explanation);

      if (!PUBLIC_BASE_URL) {
        await sendText(waId, "⚠️ Falta configurar PUBLIC_BASE_URL para enviar imagen.");
        return;
      }

      await sendText(waId, "🖼️ Generando imagen técnica...");
      const filename = await generateExerciseImage(text);

      const imageUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
      await sendImage(waId, imageUrl, "Ejecución correcta del ejercicio");

      return;
    }

    await sendText(waId, "Consultame por un ejercicio y te explico cómo hacerlo correctamente 💪");
  } catch (err) {
    console.error("Error general:", err);
  }
});

// ======================
// DETECTAR EJERCICIO
// ======================
function isExerciseQuery(text) {
  const keywords = ["sentadilla", "peso muerto", "press banca", "dominadas", "remo", "curl", "ejercicio"];
  return keywords.some(k => text.toLowerCase().includes(k));
}

// ======================
// GENERAR EXPLICACIÓN
// ======================
async function generateExerciseExplanation(userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `
Actúa como entrenador personal profesional.
Explica detalladamente cómo realizar correctamente este ejercicio:
"${userText}"

Incluye:
- Músculos trabajados
- Técnica paso a paso
- Errores comunes
- Consejos de seguridad
`
        }]
      }]
    })
  });

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "No pude generar explicación.";
}

// ======================
// GENERAR IMAGEN
// ======================
async function generateExerciseImage(userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `
Create a clean instructional fitness illustration showing correct execution of:
"${userText}"

White background, gym clothing, correct posture.
No text, no watermark.
`
        }]
      }]
    })
  });

  const data = await response.json();

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find(p => p.inlineData?.data);

  if (!inline?.inlineData?.data) {
    throw new Error("No image returned");
  }

  const buffer = Buffer.from(inline.inlineData.data, "base64");
  const filename = crypto.randomBytes(10).toString("hex") + ".png";
  fs.writeFileSync(path.join(GENERATED_DIR, filename), buffer);

  return filename;
}

// ======================
// WHATSAPP SENDERS
// ======================
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

async function sendImage(to, imageUrl, caption) {
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
      type: "image",
      image: { link: imageUrl, caption }
    })
  });
}

async function sendLongText(to, text) {
  const max = 3500;
  if (text.length <= max) {
    await sendText(to, text);
  } else {
    for (let i = 0; i < text.length; i += max) {
      await sendText(to, text.slice(i, i + max));
    }
  }
}

// ======================
const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => console.log("🚀 Server on port", port));
