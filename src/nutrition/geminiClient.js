const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";

async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

export async function callGemini(prompt, { responseMimeType, maxOutputTokens = 4096, temperature = 0.2 } = {}) {
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

export function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export async function getPlanJson(prompt, { requireKeys = [] } = {}) {
  const raw1 = await callGemini(prompt, {
    responseMimeType: "application/json",
    temperature: 0.2,
    maxOutputTokens: 4096
  });
  const obj1 = safeJsonParse(raw1);
  if (obj1 && requireKeys.every(k => obj1[k] !== undefined && obj1[k] !== null)) return obj1;

  const raw2 = await callGemini(
    `Devolvé SOLO JSON VÁLIDO (sin texto extra). Si falta algún campo, agregalo. Repará y completá este JSON:\n\n${raw1}`,
    { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 4096 }
  );
  const obj2 = safeJsonParse(raw2);
  if (obj2 && requireKeys.every(k => obj2[k] !== undefined && obj2[k] !== null)) return obj2;

  return null;
}
