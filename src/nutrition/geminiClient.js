const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

export async function callGemini(prompt, { responseMimeType, maxOutputTokens = 2400, temperature = 0.2 } = {}) {
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

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await safeRead(r);
  if (!r.ok || data?.error) {
    const code = data?.error?.code || r.status;
    const msg = data?.error?.message || JSON.stringify(data);
    const err = new Error(`Gemini error ${code}: ${msg}`);
    err.code = code;
    throw err;
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export async function getJsonWithRepair(prompt, { requireKeys = [], attempts = 3 } = {}) {
  let lastRaw = "";

  for (let i = 1; i <= attempts; i++) {
    const raw = await callGemini(prompt, {
      responseMimeType: "application/json",
      temperature: i === 1 ? 0.2 : 0.0,
      maxOutputTokens: 2400
    });

    lastRaw = raw;
    const obj = safeJsonParse(raw);
    if (obj && requireKeys.every(k => obj[k] !== undefined)) return obj;

    // repair
    const repaired = await callGemini(
      `Devolvé SOLO JSON VÁLIDO (sin texto extra). Repará y completá este JSON:\n\n${raw}`,
      { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 2400 }
    );
    const obj2 = safeJsonParse(repaired);
    if (obj2 && requireKeys.every(k => obj2[k] !== undefined)) return obj2;
  }

  // último intento: fuerza “solo json válido”
  const force = await callGemini(
    `DEVOLVÉ SOLO JSON VÁLIDO. Sin explicaciones. Sin markdown.\n\n${prompt}`,
    { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 2400 }
  );
  const obj3 = safeJsonParse(force);
  if (obj3 && requireKeys.every(k => obj3[k] !== undefined)) return obj3;

  const err = new Error("Failed to get valid JSON from Gemini");
  err.lastRaw = lastRaw;
  throw err;
}

// Compatibilidad con tu nombre anterior
export async function getPlanJson(prompt, opts = {}) {
  return getJsonWithRepair(prompt, opts);
}
