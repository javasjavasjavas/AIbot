import express from "express";
import path from "node:path";

import {
  logInfo,
  logError,
  safeRead,
  sleep,
  extractRetryDelaySeconds,
  normalizeText,
  splitForWhatsApp,
  whatsappSafeText,
} from "./utils.js";

import {
  sendText,
  sendImage,
  sendLongText,
} from "./whatsapp.js";

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
      // gemini key lo valida nutritionFlow internamente
    },
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
    logInfo(LOG_LEVEL, "✅ Webhook verificado OK");
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

    logInfo(LOG_LEVEL, `📩 ${waId}: ${text}`);

    // 0) MENU COMMAND
    if (isMenuCommand(text)) {
      resetToMenu(waId);
      await sendLongText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, formatMenuText(), 1400);
      return;
    }

    const state = getState(waId);

    // 1) Si estamos en menu: decidir rama
    if (state.flow === "menu") {
      // Auto-disparo nutrición si el mensaje inicial suena a nutrición
      if (shouldAutoStartNutrition(text)) {
        await handleNutritionMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, text, { PUBLIC_BASE_URL, LOG_LEVEL });
        return;
      }

      // Si suena a gym, seguimos con gym. Si no, mostramos menú.
      if (!isGymIntent(text)) {
        await sendLongText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, formatMenuText(), 1400);
        return;
      }
      state.flow = "gym";
    }

    // 2) Si estamos en nutrición, delegar TODO ahí
    if (state.flow === "nutrition") {
      await handleNutritionMessage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, text, { PUBLIC_BASE_URL, LOG_LEVEL });
      return;
    }

    // 3) GYM FLOW
    if (isAskingPrices(text)) {
      await sendLongText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, formatPlansText(), 1400);
      if (PLANS_IMAGE_URL) await sendImage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, PLANS_IMAGE_URL, "Planes disponibles");
      return;
    }

    if (isAskingClasses(text)) {
      await sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, "Decime qué clase te interesa (Funcional / Zumba / etc.) y te paso días y horarios.");
      if (CLASSES_IMAGE_URL) await sendImage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, CLASSES_IMAGE_URL, "Grilla de clases");
      return;
    }

    // Imagen pedida sin ejercicio: usa el último ejercicio guardado en nutritionFlow (shared map) o simple fallback
    if (wantsImage(text) && !isExerciseIntent(text)) {
      // en este refactor lo dejamos simple: pedir ejercicio exacto
      await sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, "Dale. Decime el ejercicio exacto (por ejemplo: 'vuelos laterales') y te genero la imagen.");
      return;
    }

    // Ejercicios + imagen
    if (isExerciseIntent(text)) {
      // explicación con Gemini la dejamos en nutritionFlow? -> no, en este refactor mantenemos minimal: solo imagen + CTA.
      // Si querés, después lo movemos a gymCoachFlow.js.
      await sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, "Perfecto. Si querés una imagen, decime: 'mostrame una imagen'.");
      if (wantsImage(text)) {
        try {
          await sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, "Generando imagen descriptiva...");
          const filename = await generateExerciseImageAndSave(buildExerciseImagePrompt(text));
          const imgUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
          await sendImage({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, imgUrl, "Ejecución correcta (referencia)");
        } catch (e) {
          logError(LOG_LEVEL, "❌ Error generando imagen:", e?.message || e);
          await sendText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, "La imagen falló. Probá de nuevo en 1 minuto.");
        }
      }
      return;
    }

    // Default: mostrar menú (más claro)
    await sendLongText({ PHONE_NUMBER_ID, WHATSAPP_TOKEN }, waId, formatMenuText(), 1400);

  } catch (err) {
    logError(LOG_LEVEL, "❌ Error webhook:", err);
  }
});

// ======================
// START
// ======================
const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => {
  logInfo(LOG_LEVEL, `🚀 Server on port ${port}`);
  logInfo(LOG_LEVEL, "✅ Public base URL:", PUBLIC_BASE_URL);
});
