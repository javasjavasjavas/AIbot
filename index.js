import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.get("/", (req, res) => res.send("Bot con Gemini Flash Latest OK"));

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

    const aiResponse = await askGemini(textReceived);
    await sendText(waId, aiResponse);

  } catch (err) {
    console.error("❌ Error General Webhook:", err);
  }
});

async function askGemini(prompt) {
    try {
        // Usamos el modelo exacto 'gemini-1.5-flash-latest' que es el más compatible
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Responde de forma breve y amable: ${prompt}` }] }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error("❌ Error API Google:", data.error.message);
            return "Hola! Mi sistema de IA se está reiniciando. ¿En qué más puedo ayudarte? 🤖";
        }

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
            return data.candidates[0].content.parts[0].text;
        }
        
        return "Recibí tu mensaje, pero no pude generar una respuesta clara.";
    } catch (error) {
        console.error("❌ Error en askGemini:", error);
        return "Hubo un error al procesar tu mensaje. 🧠🔄";
    }
}

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
