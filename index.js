import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

// Variables de entorno (Configuradas en el Dashboard de Render)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Configuración de Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { maxOutputTokens: 200 } // Respuestas breves para WhatsApp
});

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

    // Corrección para Argentina
    if (waId.startsWith("549")) waId = "54" + waId.substring(3);

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    // --- LÓGICA 1: PRECIOS CON FOTOS (Prioridad) ---
    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta") || lowerText.includes("planes")) {
        await sendText(waId, "¡Claro! Aquí tienes nuestras opciones principales:");
        
        // Opción 1
        await sendImage(waId, "https://picsum.photos/seed/plan1/600/400", "🌟 *Plan Básico*\nPrecio: $1.000\nIdeal para uso personal.");
        
        // Opción 2
        await sendImage(waId, "https://picsum.photos/seed/plan2/600/400", "🚀 *Plan Pro*\nPrecio: $2.500\nIncluye soporte 24/7.");
        
        // Opción 3
        await sendImage(waId, "https://picsum.photos/seed/plan3/600/400", "🏢 *Plan Business*\nPrecio: $5.000\nPara empresas grandes.");
        return;
    }

    // --- LÓGICA 2: IA GEMINI (Para todo lo demás) ---
    const prompt = `Eres un asistente virtual de "Mi Empresa". Eres amable, breve y usas emojis. 
    Responde a esto: "${textReceived}"`;

    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();

    await sendText(waId, aiResponse);
    console.log("✅ Respuesta de IA enviada");

  } catch (err) {
    console.error("❌ Webhook error:", err);
  }
});

// --- FUNCIONES AUXILIARES ---

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
