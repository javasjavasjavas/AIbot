import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Configuración de Gemini mejorada
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Usamos gemini-1.5-flash que es el estándar actual
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.get("/", (req, res) => res.send("Bot Inteligente OK"));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (!value?.messages) return;

    const message = value?.messages?.[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;
    const textReceived = message?.text?.body || "";

    if (waId.startsWith("549")) waId = "54" + waId.substring(3);

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    // Lógica de Precios
    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta") || lowerText.includes("planes")) {
        await sendText(waId, "¡Claro! Aquí tienes nuestras opciones principales:");
        await sendImage(waId, "https://picsum.photos/seed/plan1/600/400", "🌟 *Plan Básico*\nPrecio: $1.000");
        await sendImage(waId, "https://picsum.photos/seed/plan2/600/400", "🚀 *Plan Pro*\nPrecio: $2.500");
        return;
    }

    // --- LÓGICA DE IA ---
    // Agregamos un bloque try-catch específico para la IA para no romper el bot si falla
    try {
        const prompt = `Eres un asistente virtual amable. Responde brevemente: "${textReceived}"`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiResponse = response.text();

        await sendText(waId, aiResponse);
    } catch (aiErr) {
        console.error("❌ Error en Gemini:", aiErr.message);
        await sendText(waId, "Lo siento, mi cerebro artificial tuvo un pequeño hipo. ¿Podrías repetir eso?");
    }

  } catch (err) {
    console.error("❌ Webhook error:", err);
  }
});

async function sendText(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

async function sendImage(to, url, caption) {
  const fbUrl = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  await fetch(fbUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ 
        messaging_product: "whatsapp", 
        to, 
        type: "image", 
        image: { link: url, caption: caption } 
    }),
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Bot en puerto ${port}`));
