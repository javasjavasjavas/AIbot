import express from "express";

import { sendText, sendImage, sendLongText } from "./whatsapp.js";
import {
  isAskingPrices,
  isAskingClasses,
  isAskingGymHours,
  isExerciseIntent,
  wantsImage,
  formatPlansText,
  formatGymHoursText,
  isGymIntent,
  CLASSES_IMAGE_URL,
  PLANS_IMAGE_URL
} from "./gymContent.js";
import {
  generateExerciseImageAndSave,
  buildExerciseImagePrompt,
  initImageStorage
} from "./imageService.js";
import {
  isMenuCommand,
  formatMenuText,
  shouldAutoStartNutrition,
  handleNutritionMessage
} from "./nutrition/nutritionFlow.js";
import { getState, resetToMenu } from "./nutrition/state.js";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ALLOWED_TEST_NUMBERS_RAW = process.env.ALLOWED_TEST_NUMBERS || process.env.ALLOWED_TEST_NUMBER || "";

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://aibot-hsjq.onrender.com").replace(/\/$/, "");
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

function logInfo(...args) { if (LOG_LEVEL !== "quiet") console.log(...args); }
function logWarn(...args) { if (LOG_LEVEL !== "quiet") console.warn(...args); }
function logError(...args) { console.error(...args); }

const app = express();
app.use(express.json());

const { GENERATED_DIR } = initImageStorage();
app.use("/img", express.static(GENERATED_DIR));

const api = { PHONE_NUMBER_ID, WHATSAPP_TOKEN };
const baseCtx = { PUBLIC_BASE_URL, LOG_LEVEL };

function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

const allowedTestNumbers = new Set(
  ALLOWED_TEST_NUMBERS_RAW
    .split(",")
    .map((n) => normalizePhoneNumber(n))
    .filter(Boolean)
);

if (allowedTestNumbers.size) {
  logInfo("Allowlist enabled for wa_id:", [...allowedTestNumbers].join(", "));
} else {
  logInfo("Allowlist disabled (no ALLOWED_TEST_NUMBERS configured).");
}

// Idempotency for incoming webhook events (Meta can retry same message id).
const seenMessageIds = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;

// Per-user queue to avoid race conditions when multiple webhooks arrive together.
const userQueue = new Map();

function normalizeWaId(rawWaId) {
  return String(rawWaId || "").trim();
}

function isAllowedWaId(waId) {
  if (!allowedTestNumbers.size) return true;
  const normalized = normalizePhoneNumber(waId);
  return allowedTestNumbers.has(normalized);
}

function cleanupSeenMessageIds(now = Date.now()) {
  for (const [id, ts] of seenMessageIds.entries()) {
    if (now - ts > SEEN_TTL_MS) seenMessageIds.delete(id);
  }
}

function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  cleanupSeenMessageIds(now);
  const prev = seenMessageIds.get(messageId);
  if (prev && now - prev <= SEEN_TTL_MS) return true;
  seenMessageIds.set(messageId, now);
  return false;
}

function enqueueUserTask(waId, task) {
  const prev = userQueue.get(waId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(task)
    .catch((err) => {
      logError("Error in queued user task:", err?.message || err);
    })
    .finally(() => {
      if (userQueue.get(waId) === next) userQueue.delete(waId);
    });

  userQueue.set(waId, next);
  return next;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isGymEntry(text) {
  const t = normalizeText(text);
  return t === "1" || t.includes("gimnasio") || t === "gym";
}

function isNutritionEntry(text) {
  const t = normalizeText(text);
  return t === "2" || t.includes("nutri") || t.includes("nutricion");
}

function formatGymMenuText() {
  return (
    "Perfecto. Elegi una opcion:\n\n" +
    "1) Conoce nuestros planes y precios\n" +
    "2) Consultar por una clase\n" +
    "3) Quiero saber como ejecutar un ejercicio\n\n" +
    "Responde 1, 2 o 3."
  );
}

function formatTopicScopeText() {
  return (
    "Por ahora puedo ayudarte con estos temas:\n\n" +
    "1) Gimnasio: planes, precios, horarios y ejercicios\n" +
    "2) Nutricion: onboarding y plan semanal\n\n" +
    "Escribi 'gimnasio' o 'nutricion' para empezar."
  );
}

function parseGymMenuChoice(text) {
  const t = normalizeText(text);
  if (t === "1" || t.includes("plan") || t.includes("precio")) return 1;
  if (t === "2" || t.includes("clase") || t.includes("horario")) return 2;
  if (t === "3" || t.includes("ejercicio") || t.includes("como ejecutar") || t.includes("como hacer")) return 3;
  return 0;
}

async function processIncomingText(waId, text, ctx = {}) {
  if (!text.trim()) return;

  logInfo(`IN ${waId}: ${text}`);

  if (isMenuCommand(text)) {
    resetToMenu(waId);
    await sendLongText(api, waId, formatMenuText(), 1400);
    return;
  }

  const state = getState(waId);

  if (state.flow === "menu") {
    if (isNutritionEntry(text) || shouldAutoStartNutrition(text)) {
      await handleNutritionMessage(api, waId, text, ctx);
      return;
    }

    if (isGymEntry(text)) {
      state.flow = "gym";
      state.gymStep = "menu";
      await sendLongText(api, waId, formatGymMenuText(), 1400);
      return;
    }

    if (!isGymIntent(text)) {
      await sendLongText(api, waId, formatTopicScopeText(), 1400);
      return;
    }

    state.flow = "gym";
    state.gymStep = null;
  }

  if (state.flow === "nutrition") {
    await handleNutritionMessage(api, waId, text, ctx);
    return;
  }

  if (state.flow === "gym" && state.gymStep === "menu") {
    const choice = parseGymMenuChoice(text);
    if (choice === 1) {
      state.gymStep = null;
      await sendLongText(api, waId, formatPlansText(), 1400);
      if (PLANS_IMAGE_URL) await sendImage(api, waId, PLANS_IMAGE_URL, "Planes disponibles");
      return;
    }
    if (choice === 2) {
      state.gymStep = null;
      await sendText(api, waId, "Decime que clase te interesa (Funcional / Zumba / etc.) y te paso dias y horarios.");
      if (CLASSES_IMAGE_URL) await sendImage(api, waId, CLASSES_IMAGE_URL, "Grilla de clases");
      return;
    }
    if (choice === 3) {
      state.gymStep = null;
      await sendText(api, waId, "Decime el ejercicio exacto y, si queres, agrega: 'mostrame una imagen'.");
      return;
    }
    await sendLongText(api, waId, formatGymMenuText(), 1400);
    return;
  }

  if (isAskingPrices(text)) {
    await sendLongText(api, waId, formatPlansText(), 1400);
    if (PLANS_IMAGE_URL) await sendImage(api, waId, PLANS_IMAGE_URL, "Planes disponibles");
    return;
  }

  if (isAskingGymHours(text)) {
    await sendLongText(api, waId, formatGymHoursText(), 1400);
    return;
  }

  if (isAskingClasses(text)) {
    await sendText(api, waId, "Decime que clase te interesa (Funcional / Zumba / etc.) y te paso dias y horarios.");
    if (CLASSES_IMAGE_URL) await sendImage(api, waId, CLASSES_IMAGE_URL, "Grilla de clases");
    return;
  }

  if (wantsImage(text) && !isExerciseIntent(text)) {
    await sendText(api, waId, "Dale. Decime el ejercicio exacto (por ejemplo: 'vuelos laterales') y te genero la imagen.");
    return;
  }

  if (isExerciseIntent(text)) {
    if (!wantsImage(text)) {
      await sendText(api, waId, "Perfecto. Si queres una imagen, decime: 'mostrame una imagen' + el ejercicio.");
      return;
    }

    try {
      await sendText(api, waId, "Generando imagen descriptiva...");
      const filename = await generateExerciseImageAndSave(buildExerciseImagePrompt(text));
      const imgUrl = `${PUBLIC_BASE_URL}/img/${filename}`;
      await sendImage(api, waId, imgUrl, "Ejecucion correcta (referencia)");
    } catch (e) {
      logError("Error generando imagen:", e?.message || e);
      await sendText(api, waId, "La imagen fallo. Proba de nuevo en 1 minuto.");
    }
    return;
  }

  await sendLongText(api, waId, formatTopicScopeText(), 1400);
}

app.get("/", (req, res) => res.send("Gym Coach Bot ONLINE"));
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

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logInfo("Webhook verificado OK");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  // ACK immediately so Meta does not retry due timeout.
  res.sendStatus(200);

  const entry = req.body?.entry?.[0];
  const value = entry?.changes?.[0]?.value;
  const messages = Array.isArray(value?.messages) ? value.messages : [];
  if (!messages.length) return;

  for (const message of messages) {
    const messageId = message?.id || "";
    if (isDuplicateMessage(messageId)) {
      logWarn(`Skip duplicate message id=${messageId}`);
      continue;
    }

    const waId = normalizeWaId(value?.contacts?.[0]?.wa_id || message?.from || "");
    const text = message?.text?.body || "";
    const msgType = message?.type || "";

    if (!waId) continue;
    if (!isAllowedWaId(waId)) {
      logWarn(`Skip message from non-allowlisted wa_id=${waId}`);
      continue;
    }
    if (msgType !== "text") continue;
    if (!text.trim()) continue;

    enqueueUserTask(waId, async () => {
      try {
        await processIncomingText(waId, text, baseCtx);
      } catch (err) {
        logError("Error webhook message:", err?.message || err);
      }
    });
  }
});

const port = process.env.PORT || 1000;
app.listen(port, "0.0.0.0", () => {
  logInfo(`Server on port ${port}`);
  logInfo("Public base URL:", PUBLIC_BASE_URL);
});
