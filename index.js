import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.get("/", (req, res) => res.send("Bot con Fetch Directo OK"));

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

    // Prioridad: Precios
    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta")) {
        await sendText(waId, "💰 *Nuestros Planes:*");
        await sendImage(waId, "https://picsum.photos/seed/plan1/600/400", "🌟 Plan Básico: $1.000");
        await sendImage(waId, "https://picsum.photos/seed/plan2/600/400", "🚀 Plan Pro: $2.500");
        return;
    }

    // Llamada a IA vía Fetch Directo (v1 estable)
    const aiResponse = await askGemini(textReceived);
    await sendText(waId, aiResponse);

  } catch (err) {
    console.error("❌ Error General:", err);
  }
});

// NUEVA FUNCIÓN: Habla con Gemini sin usar la librería oficial
async function askGemini(prompt) {
    try {
        // Usamos la versión v1 (estable) en lugar de v1beta
        const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `Eres un asistente de WhatsApp breve y amable. Responde a: ${prompt}` }] }]
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error("❌ Error de Google API:", data.error.message);
            return "Lo siento, mi sistema está en mantenimiento. 🤖";
        }

        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("❌ Error en askGemini:", error);
        return "Hubo un error al procesar tu mensaje.";
    }
}

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
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "image", image: { link: url, caption: caption } }),
  });
}

const port = process.env.PORT || 1000;
app.listen(port, () => console.log(`🚀 Server on port ${port}`));
