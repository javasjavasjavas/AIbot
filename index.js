import express from "express";

const app = express();
app.use(express.json());

// Variables de Entorno
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.get("/", (req, res) => res.send("Bot con Gemini Pro OK"));

// Webhook Verificación
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Webhook Recepción
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
    if (waId.startsWith("549")) {
        waId = "54" + waId.substring(3);
    }

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta")) {
        await sendText(waId, "💰 *Nuestros Planes:*");
        await sendImage(waId, "https://picsum.photos/seed/p1/600/400", "🌟 *Plan Básico*\n$1.000");
        await sendImage(waId, "https://picsum.photos/seed/p2/600/400", "🚀 *Plan Pro*\n$2.500");
        return;
    }

    // Respuesta IA
    const aiResponse = await askGemini(textReceived);
    await sendText(waId, aiResponse);

  } catch (err) {
    console.error("❌ Error General Webhook:", err);
  }
});

// Función Gemini Pro corregida
async function askGemini(prompt) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Eres un asistente de WhatsApp breve y amable. Responde a: ${prompt}` }] }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error("❌ Error API Google:", data.error.message);
            return "Hola! Estoy teniendo un pequeño problema técnico, ¿podrías repetir eso? 🤖";
        }

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
            return data.candidates[0].content.parts[0].text;
        }
        
        return "Entendido, pero no pude generar una respuesta clara ahora mismo.";
    } catch (error) {
        console.error("❌ Error en askGemini:", error);
        return "Hubo un error al procesar tu mensaje. 🧠🔄";
    }
}

// Funciones Meta
async function sendText(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

async function sendImage(to, url, caption) {
  const fbUrl = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  await fetch(fbUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
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
