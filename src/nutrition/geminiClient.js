// src/nutrition/geminiClient.js
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

function logDebug(...args) { if (LOG_LEVEL === "debug") console.log(...args); }
function logWarn(...args) { if (LOG_LEVEL !== "quiet") console.warn(...args); }
function logError(...args) { console.error(...args); }

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function isRetriableStatus(code) {
  return code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
}

async function fetchGemini(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await safeRead(r);

  if (!r.ok || data?.error) {
    const code = data?.error?.code || r.status;
    const msg = data?.error?.message || (typeof data === "string" ? data : JSON.stringify(data));
    const err = new Error(`Gemini error ${code}: ${msg}`);
    err.code = code;
    err.raw = data;
    throw err;
  }

  return data;
}

export async function callGemini(
  prompt,
  { responseMimeType, maxOutputTokens = 2400, temperature = 0.2 } = {}
) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      topP: 0.9,
      ...(responseMimeType ? { responseMimeType } : {})
    }
  };

  // ✅ Retry/backoff para 429 y 5xx
  const backoffs = [0, 800, 1600, 2600]; // ms
  let lastErr = null;

  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i]) await sleep(backoffs[i]);

    try {
      const data = await fetchGemini(url, payload);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      return text;
    } catch (e) {
      lastErr = e;
      const code = Number(e?.code || 0);

      if (isRetriableStatus(code) && i < backoffs.length - 1) {
        logWarn(`⚠️ Gemini retriable error (${code}). Retry ${i + 1}/${backoffs.length - 1}`);
        continue;
      }

      // No retriable o sin retries restantes
      logError("❌ Gemini call failed:", e?.message || e);
      throw e;
    }
  }

  throw lastErr || new Error("Gemini call failed");
}

export async function getJsonWithRepair(prompt, { requireKeys = [], attempts = 3 } = {}) {
  let lastRaw = "";

  for (let i = 1; i <= attempts; i++) {
    // 1) Intento normal (JSON)
    const raw = await callGemini(prompt, {
      responseMimeType: "application/json",
      temperature: i === 1 ? 0.25 : 0.0,
      maxOutputTokens: 2400
    });

    lastRaw = raw;
    const obj = safeJsonParse(raw);
    if (obj && requireKeys.every(k => obj[k] !== undefined)) {
      return obj;
    }

    // 2) Repair si no parsea o faltan keys
    const repairPrompt =
      `Devolvé SOLO JSON VÁLIDO (sin texto extra, sin markdown). ` +
      `Repará y completá este JSON para que cumpla el esquema requerido:\n\n${raw}`;

    const repaired = await callGemini(repairPrompt, {
      responseMimeType: "application/json",
      temperature: 0.0,
      maxOutputTokens: 2400
    });

    const obj2 = safeJsonParse(repaired);
    if (obj2 && requireKeys.every(k => obj2[k] !== undefined)) {
      return obj2;
    }

    logDebug("🔎 getJsonWithRepair failed attempt", i, { lastRawPreview: String(lastRaw).slice(0, 220) });
  }

  // 3) Último intento ultra estricto
  const force = await callGemini(
    `DEVOLVÉ SOLO JSON VÁLIDO. Sin explicaciones. Sin texto extra.\n\n${prompt}`,
    { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 2400 }
  );

  const obj3 = safeJsonParse(force);
  if (obj3 && requireKeys.every(k => obj3[k] !== undefined)) return obj3;

  const err = new Error("Failed to get valid JSON from Gemini after repairs");
  err.lastRaw = lastRaw;
  logError("❌ JSON parse/repair failed. lastRaw preview:", String(lastRaw).slice(0, 400));
  throw err;
}

// Alias compat
export async function getPlanJson(prompt, opts = {}) {
  return getJsonWithRepair(prompt, opts);
}
