import express from "express";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => {
  res.send("Bot WhatsApp OK");
});

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
    if (!message) return;

    let waId = value?.contacts?.[0]?.wa_id || message.from;
    const textReceived = (message?.text?.body || "").toLowerCase().trim(); // Pasamos a minúsculas
    
    // Corrección para Argentina
    if (waId.startsWith("549")) {
        waId = "54" + waId.substring(3);
    }

    console.log(`📩 Recibido: ${textReceived} de ${waId}`);

    // --- LÓGICA DE RESPUESTAS PERSONALIZADAS ---
    let respuesta = "";

    if (textReceived === "hola" || textReceived === "buen día") {
        respuesta = "¡Hola! 👋 Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?";
    } 
    else if (textReceived.includes("precio") || textReceived.includes("costo")) {
        respuesta = "Nuestros servicios varían según tus necesidades. ¿Te gustaría que un asesor humano te contacte?";
    } 
    else if (textReceived === "chau" || textReceived === "gracias") {
        respuesta = "¡De nada! Fue un placer ayudarte. ¡Hasta luego! 😊";
    } 
    else {
        respuesta = `Recibí tu mensaje: "${textReceived}". No estoy seguro de cómo responder a eso, pero puedes intentar decir "Hola" o preguntar por "Precios".`;
    }

    await sendText(waId, respuesta);
    console.log("✅ Respuesta enviada con éxito");
    
  } catch (err) {
    console.error("❌ Webhook error:", err?.message || err);
  }
});

async function sendText(to, text) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await resp.text();
  if (!resp.ok) {
      console.error(`❌ Error Meta API: ${data}`);
      throw new Error(`sendText failed: ${data}`);
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
