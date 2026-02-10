import express from "express";

const app = express();
app.use(express.json());

// Variables de Entorno (Deben estar configuradas en Render)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.get("/", (req, res) => res.send("Bot con Gemini Pro OK"));

// Webhook para Verificación de Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Webhook para recibir mensajes
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    if (!value?.messages) return;

    const message = value?.messages?.[0];
    let waId = value?.contacts?.[0]?.wa_id || message.from;
    const textReceived = message?.text?.body || "";

    // 🇦🇷 Corrección específica para números de Argentina
    // Transforma 549... en 54... para permitir el envío de respuesta
    if (waId.startsWith("549")) {
        waId = "54" + waId.substring(3);
    }

    console.log(`📩 Mensaje de ${waId}: ${textReceived}`);

    // --- LÓGICA 1: PRECIOS Y PLANES CON FOTOS ---
    const lowerText = textReceived.toLowerCase();
    if (lowerText.includes("precio") || lowerText.includes("cuánto cuesta") || lowerText.includes("planes")) {
        await sendText(waId, "💰 *Nuestros Planes Vigentes:*");
        
        await sendImage(wa
