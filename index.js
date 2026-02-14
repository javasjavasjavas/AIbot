import express from "express";
import path from "node:path";

import { sendText, sendImage, sendLongText } from "./whatsapp.js";
import {
  isAskingPrices,
  isAskingClasses,
  isExerciseIntent,
  wantsImage,
  formatPlansText,
  isGymIntent,
  CLASSES_IMAGE_URL,
  PLANS_IMAGE_URL,
} from "./gymContent.js";

import {
  generateExerciseImageAndSave,
  buildExerciseImagePrompt,
  initImageStorage,
} from "./imageService.js";

import {
  getState,
  resetToMenu,
  isMenuCommand,
  formatMenuText,
  shouldAutoStartNutrition,
  handleNutritionMessage,
} from "./nutritionFlow.js";

// ======================
// ENV
// ======================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://aibot-hsjq.onrender.com").replace(/\/$/, "");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

function logInfo(...args) { if (LOG_LEVEL !== "quiet") console.log(...args); }
function logError(...args) { console.error(...args); }

const app = express();
app.use(express.json());

// ======================
// IMAGE STORAGE (static)
// ======================
const { GENERATED_DIR } = initImageStorage();
app.use("/img", express.static(GENERATED_DIR));

// ======================
// ROUTES
// ======================
app.get("/", (req, res) => res.send("✅ Gym Coach Bot ONLINE"));
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    publicBaseUrl: PUBLIC_BASE_URL,
    env: {
      hasVerifyToken: !!VERIFY_TOKEN,
      hasWhatsappToken: !!WHATSAPP_TOKEN,
      hasPhoneNumberId: !!PHONE_NUMBER_ID,
      hasGeminiKey: !!process.env.GEMINI_API_KEY
    }
  });
});

// ======================
// WEBHOOK VERIFY
// ======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logInfo("✅ Webhook verificado OK");
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
    let waId = value?.contacts?.[0]?.wa_id || message.from;

    // Argentina 549 -> 54
    if (waId?.startsWith("549")) waId = "54" + waId.substring(3);

    const text = message?.text?.body || "";
    if (!text.trim()) return;

    logInfo(`📩 ${waId}: ${text}`);

    const api = { PHONE_NUMBER_ID, WHATSAPP_TOKEN };

    // MENU COMMAND
    if (isMenuCommand(text)) {
      resetToMenu(waId);
      await sendLongText(api, waId, formatMenuText(), 1400);
      return;
    }

    const state = getState(waId);

    // MENU: decidir rama
    if (state.flow === "menu") {
      if (shouldAutoStartNutrition(text)) {
        await handleNutritionMessage(api, waId, text, { PUBLIC_BASE_URL, LOG_LEVEL });
        return;
      }

      if (!isGymIntent(text)) {
        await sendLongText(api, waId, formatMenuText(), 1400);
        return;
      }

      state.flow = "gym";
    }

    // NUTRITION FLOW
    if (state.flow === "nutrition") {
      await handleNutritionMessage(api, waId, text, { PUBLIC_BASE_URL, LOG_LEVEL });
      return;
    }

    // GYM FLOW
    if (isAskingPrices(text)) {
      await sendLongText(api, waId, formatPlansText(), 1400);
      if (PLANS_IMAGE_URL) await sendImage(api, waId, PLANS_IMAGE_URL, "Planes disponibles");
      return;
    }

    if (isAskingClasses(text)) {
      await sendText(api, waId, "Decime qué clase te interesa (Funcional / Zumba / etc.) y te paso días y horarios.");
      if (CLASSES_IMAGE_URL) await sendImage(api, waId, CLASSES_IMAGE_URL, "Grilla de clases");
      return;
    }

    if (wantsImage(text) && !isExerciseIntent(text)) {
      await sendText(api, waId, "Dale. Decime el ejercicio exacto (por ejemplo: 'vuelos laterales') y te genero la imagen.");
      return;
    }

    if (isExerciseIntent(text)) {
      if (!wantsImage(text)) {
        await sendText(api, waId, "Perfecto. Si querés una imagen, decime: 'mostrame una imagen' + el ejercicio.");
        return;
      }

      try {
        await sendText(api, waId, "Generando imagen descriptiva...");
        const filename = await generateExerciseImageAndSave(buildExerciseImagePrompt(text));
        const imgUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
        await sendImage(api, waId, imgUrl, "Ejecución correcta (referencia)");
      } catch (e) {
        logError("❌ Error generando imagen:", e?.message || e);
        await sendText(api, waId, "La imagen falló. Probá de nuevo en 1 minuto.");
      }
      return;
    }

    // Default
    await sendLongText(api, waId, formatMenuText(), 1400);

  } catch (err) {
    logError("❌ Error webhook:", err);
  }
});

// ======================
// START
// ======================
const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => {
  logInfo(`🚀 Server on port ${port}`);
  logInfo("✅ Public base URL:", PUBLIC_BASE_URL);
});
