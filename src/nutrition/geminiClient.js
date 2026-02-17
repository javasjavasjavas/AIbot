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

function stripCodeFences(s) {
  return String(s || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObjectText(s) {
  const t = String(s || "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1).trim();
  return t.trim();
}

function parseJsonLoose(raw) {
  const base = String(raw || "").trim();
  if (!base) return null;

  const candidates = [
    base,
    stripCodeFences(base),
    extractJsonObjectText(base),
    extractJsonObjectText(stripCodeFences(base))
  ];

  for (const text of candidates) {
    const obj = safeJsonParse(text);
    if (obj) return obj;
  }

  return null;
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
  { responseMimeType, maxOutputTokens = 8192, temperature = 0.2 } = {}
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

  const backoffs = [0, 900, 1800, 3000];
  let lastErr = null;

  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i]) await sleep(backoffs[i]);

    try {
      const data = await fetchGemini(url, payload);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      const finishReason = data?.candidates?.[0]?.finishReason || "";
      if (finishReason && finishReason !== "STOP") {
        logWarn(`Gemini finishReason=${finishReason} (maxOutputTokens=${maxOutputTokens})`);
      }
      return text;
    } catch (e) {
      lastErr = e;
      const code = Number(e?.code || 0);

      if (isRetriableStatus(code) && i < backoffs.length - 1) {
        logWarn(`Gemini retriable (${code}). Retry ${i + 1}/${backoffs.length - 1}`);
        continue;
      }

      logError("Gemini call failed:", e?.message || e);
      throw e;
    }
  }

  throw lastErr || new Error("Gemini call failed");
}

export async function getJsonWithRepair(prompt, { requireKeys = [], attempts = 3 } = {}) {
  let lastRaw = "";

  for (let i = 1; i <= attempts; i++) {
    const raw = await callGemini(prompt, {
      responseMimeType: "application/json",
      temperature: i === 1 ? 0.25 : 0.0,
      maxOutputTokens: 8192
    });

    lastRaw = raw;
    const obj = parseJsonLoose(raw);
    if (obj && requireKeys.every(k => obj[k] !== undefined)) return obj;

    const repairPrompt =
      "Devolve SOLO JSON VALIDO (sin texto extra, sin markdown). " +
      "Si hay texto extra, extrae el objeto JSON. Si esta incompleto, cerra y completa solo lo minimo " +
      "para cumplir claves requeridas. Manten estructura y tipos.\n\nJSON a reparar:\n" +
      raw;

    const repaired = await callGemini(repairPrompt, {
      responseMimeType: "application/json",
      temperature: 0.0,
      maxOutputTokens: 8192
    });

    const obj2 = parseJsonLoose(repaired);
    if (obj2 && requireKeys.every(k => obj2[k] !== undefined)) return obj2;

    logDebug("getJsonWithRepair attempt failed", i, { lastRawPreview: String(lastRaw).slice(0, 220) });
  }

  const force = await callGemini(
    "DEVOLVE SOLO JSON VALIDO. Sin explicaciones. Sin texto extra. " +
    "Sin markdown. Sin comentarios. Solo objeto JSON completo y parseable.\n\n" +
    prompt,
    { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 8192 }
  );

  const obj3 = parseJsonLoose(force);
  if (obj3 && requireKeys.every(k => obj3[k] !== undefined)) return obj3;

  const err = new Error("Failed to get valid JSON from Gemini after repairs");
  err.lastRaw = lastRaw;
  logError("JSON parse/repair failed. lastRaw preview:", String(lastRaw).slice(0, 500));
  throw err;
}

// Alias compat
export async function getPlanJson(prompt, opts = {}) {
  return getJsonWithRepair(prompt, opts);
}
