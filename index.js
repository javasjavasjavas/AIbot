import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Configuración de Gemini 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Forzamos el modelo específico que está activo y disponible
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.get("/", (req, res) => res.send("Bot Inteligente Funcionando"));

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

    // Corrección para Argentina (Eliminar el 9 intermedio)
    if (waId.startsWith("549")) waId = "54" + waId.substring(3);

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    // Prioridad: Lógica de Precios
    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta")) {
        await sendText(waId, "💰 *Nuestros Planes:*");
        await sendImage(waId, "https://picsum.photos/seed/plan1/600/400", "🌟 Plan Básico: $1.000");
        await sendImage(waId, "https://picsum.photos/seed/plan2/600/400", "🚀 Plan Pro: $2.500");
        return;
    }

    // Respuesta con IA Gemini
    try {
        const prompt = `Eres un asistente de WhatsApp. Responde de forma muy breve y con emojis. Usuario dice: ${textReceived}`;
        
        // Nueva forma de llamada más robusta
        const result = await model.generateContent(prompt);
        const aiResponse = result.response.text();

        await sendText(waId, aiResponse);
    } catch (aiErr) {
        console.error("❌ Error específico de Gemini:", aiErr.message);
        await sendText(waId, "Hola! En este momento estoy actualizando mi sistema. ¿Podrías escribirme de nuevo en un minuto? 🤖");
    }

  } catch (err) {
    console.error("❌ Error General Webhook:", err);
  }
});

// Funciones de envío a la API de Meta
async function sendText(to, text) {
  await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

async function sendImage(to, url, caption) {
  await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
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

const port = process.env.PORT || 1000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
