import { sendText, sendLongText } from "./whatsapp.js";

// ENV
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const LOG_LEVEL_DEFAULT = process.env.LOG_LEVEL || "info";

// STATE
const userState = new Map();

export function getState(waId) {
  if (!userState.has(waId)) {
    userState.set(waId, {
      flow: "menu",
      nutritionStep: null,
      nutritionProfile: {
        objective: null,
        weightKg: null,
        heightCm: null,
        age: null,
        sex: null,
        lastAnthro: null,
        bodyFatPercent: null,
        analysisNotes: null,
        flags: { suggestAnthroIn7Days: false, riskReferral: false }
      }
    });
  }
  return userState.get(waId);
}

export function resetToMenu(waId) {
  userState.set(waId, {
    flow: "menu",
    nutritionStep: null,
    nutritionProfile: {
      objective: null,
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
      lastAnthro: null,
      bodyFatPercent: null,
      analysisNotes: null,
      flags: { suggestAnthroIn7Days: false, riskReferral: false }
    }
  });
}

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// MENU
export function isMenuCommand(text) {
  const t = normalizeText(text);
  return (
    t === "menu" ||
    t === "menú" ||
    t === "inicio" ||
    t === "start" ||
    t.includes("volver al menu") ||
    t.includes("volver al menu principal") ||
    t.includes("menu principal")
  );
}

export function formatMenuText() {
  return (
    "Hola! 👋\n" +
    "¿Qué querés ver hoy?\n\n" +
    "1) Gimnasio (clases, precios, ejercicios)\n" +
    "2) Nutrición (onboarding + plan de hábitos)\n\n" +
    "Respondé: 'gimnasio' o 'nutrición'.\n" +
    "Tip: escribí 'volver al menu principal' cuando quieras volver."
  );
}

export function shouldAutoStartNutrition(text) {
  const t = normalizeText(text);
  const strong = [
    "nutricion", "nutrición", "dieta", "comida", "alimentacion", "alimentación",
    "bajar de peso", "perder peso", "bajar grasa", "perder grasa", "definicion", "definición",
    "macros", "calorias", "calorías", "proteina", "proteína", "carbohidratos",
    "volumen", "ganar musculo", "ganar músculo", "rendimiento", "hidratacion", "hidratación"
  ];
  if (strong.some(p => t.includes(p))) return true;

  const wants = t.includes("quiero") || t.includes("necesito") || t.includes("me gustaria") || t.includes("me gustaría");
  const goals = ["bajar", "perder", "definir", "marcar", "volumen", "musculo", "músculo", "rendimiento", "salud"];
  return wants && goals.some(g => t.includes(g));
}

// PARSERS
function parseObjective(text) {
  const t = normalizeText(text);
  if (["a", "b", "c", "d", "e"].includes(t)) return t.toUpperCase();

  if (t.includes("grasa") || t.includes("bajar") || t.includes("perder peso") || t.includes("definir") || t.includes("marcar")) return "A";
  if (t.includes("masa") || t.includes("musculo") || t.includes("músculo") || t.includes("volumen") || t.includes("bulk")) return "B";
  if (t.includes("recompos") || (t.includes("bajar") && (t.includes("musculo") || t.includes("músculo")))) return "C";
  if (t.includes("rendimiento") || t.includes("performance") || t.includes("mejorar tiempos") || t.includes("energia") || t.includes("energía")) return "D";
  if (t.includes("salud") || t.includes("bienestar") || t.includes("habitos") || t.includes("hábitos")) return "E";

  return null;
}

function parseWeightKg(text) {
  const t = normalizeText(text).replace(",", ".");
  const m = t.match(/(\d{2,3}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const w = Number(m[1]);
  if (!Number.isFinite(w) || w < 30 || w > 250) return null;
  return w;
}

function parseHeightCm(text) {
  const t = normalizeText(text).replace(",", ".");
  const m = t.match(/(\d{1,3}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;

  if (n >= 1.2 && n <= 2.3) return Math.round(n * 100);
  if (n >= 120 && n <= 230) return Math.round(n);
  return null;
}

function parseAge(text) {
  const t = normalizeText(text);
  const m = t.match(/(\d{1,3})/);
  if (!m) return null;
  const age = Number(m[1]);
  if (!Number.isFinite(age) || age < 10 || age > 100) return null;
  return age;
}

function parseSex(text) {
  const t = normalizeText(text);
  if (t.includes("hombre") || t.includes("masculino") || t === "m" || t.includes("varon") || t.includes("varón")) return "masculino";
  if (t.includes("mujer") || t.includes("femenino") || t === "f") return "femenino";
  if (t.includes("no bin") || t.includes("nobin") || t.includes("no-bin") || t.includes("nb")) return "no_binario";
  if (t.includes("prefiero") || t.includes("no decir") || t.includes("no quiero")) return "no_especifica";
  return null;
}

function parseBodyFatPercent(text) {
  const t = normalizeText(text).replace(",", ".");
  const m = t.match(/(\d{1,2}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const bf = Number(m[1]);
  if (!Number.isFinite(bf) || bf < 3 || bf > 60) return null;
  return bf;
}

function saysNoAnthro(text) {
  const t = normalizeText(text);
  return t.includes("no") && (t.includes("antrop") || t.includes("nunca") || t.includes("no tengo"));
}

function objectiveLabel(obj) {
  switch (obj) {
    case "A": return "Pérdida de grasa";
    case "B": return "Ganancia muscular";
    case "C": return "Recomposición corporal";
    case "D": return "Rendimiento";
    case "E": return "Salud general";
    default: return "No definido";
  }
}

// GEMINI JSON
async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

function extractRetryDelaySeconds(errObj) {
  try {
    const details = errObj?.details;
    if (!Array.isArray(details)) return null;
    const retryInfo = details.find((d) => d["@type"]?.includes("RetryInfo"));
    const s = retryInfo?.retryDelay;
    if (!s) return null;
    if (typeof s === "string" && s.endsWith("s")) return Number(s.replace("s", ""));
    return null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini(prompt, { responseMimeType, maxOutputTokens = 650, temperature = 0.0 } = {}) {
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
    err.data = data;
    throw err;
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function askGeminiJsonWithRetry(prompt, level, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await callGemini(prompt, {
        responseMimeType: "application/json",
        temperature: 0.0,
        maxOutputTokens: 650
      });

      const obj = safeJsonParse(raw);
      if (obj) return obj;

      // reparación simple: pedir JSON válido
      const repairedRaw = await callGemini(
        `Devolvé SOLO JSON VÁLIDO (sin texto extra). Repará este JSON:\n\n${raw}`,
        { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 650 }
      );

      const repairedObj = safeJsonParse(repairedRaw);
      if (repairedObj) return repairedObj;

    } catch (e) {
      const code = e?.code;
      if (code === 429 && attempt < maxAttempts) {
        const retryS = extractRetryDelaySeconds(e?.data?.error) ?? (8 * attempt);
        console.error("⚠️ Gemini 429 (json). Reintento en", retryS, "s");
        await sleep((retryS + 1) * 1000);
        continue;
      }
      console.error("❌ Gemini json error:", e?.message || e);
    }
  }
  return null;
}

// PROMPT sin md
function buildNutritionJsonPlanPrompt(profile) {
  return `
Sos el Asistente Nutricional Oficial de F45.
Estilo: técnico, claro, motivador. Sin saludos.

Reglas:
- No reemplazas a un nutricionista clínico.
- No prescribes dietas médicas ni tratamientos.
- No haces diagnósticos.
- Trabajas sobre hábitos, macros, timing, hidratación, sueño y adherencia.
- Recomendas Antropometría cada 4-6 semanas.
- Si hay condiciones médicas, TCA, embarazo, medicación metabólica o casos complejos: sugerí derivación.

Prioridades:
1) Proteína adecuada diaria.
2) Calidad alimentaria.
3) Hidratación.
4) Energía suficiente para entrenar fuerte.
5) Consistencia > perfección.

Contexto del usuario:
- Objetivo: ${profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido"}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- % grasa: ${profile.bodyFatPercent ?? "N/A"}
- Hábitos reportados: ${profile.analysisNotes ?? "N/A"}
- ¿Sugerir Antropometría en 7 días?: ${profile.flags?.suggestAnthroIn7Days ? "SI" : "NO"}

Tarea:
Genera un plan inicial para 7 días. Corto y accionable.

DEVOLVÉ SOLO JSON VÁLIDO, sin texto extra, sin markdown.

Esquema JSON:
{
  "diagnostico_breve": "string (2-3 líneas máximo)",
  "micro_ajustes": ["string", "string", "string", "string", "string", "string"],
  "timing_entreno": ["string", "string"],
  "hidratacion": ["string", "string"],
  "accion_semana": "string (1 línea)",
  "recordatorio_f45": "string (1-2 líneas)",
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}

Reglas duras:
- NO te presentes. NO saludes.
- micro_ajustes: 3 a 6 ítems.
- timing_entreno: 1 a 2 ítems.
- hidratacion: 1 a 2 ítems.
`.trim();
}

// Envío por secciones para evitar cortes
async function sendPlanInSections(api, waId, planObj) {
  const diag = planObj?.diagnostico_breve || "";
  const micro = Array.isArray(planObj?.micro_ajustes) ? planObj.micro_ajustes.filter(Boolean) : [];
  const timing = Array.isArray(planObj?.timing_entreno) ? planObj.timing_entreno.filter(Boolean) : [];
  const hidr = Array.isArray(planObj?.hidratacion) ? planObj.hidratacion.filter(Boolean) : [];
  const accion = planObj?.accion_semana || "";
  const f45 = planObj?.recordatorio_f45 || "";
  const ant = planObj?.sugerir_antropometria || "";
  const der = planObj?.derivacion || "";

  if (diag) await sendLongText(api, waId, `Diagnóstico breve:\n${diag}`, 900);

  if (micro.length) {
    await sendLongText(api, waId, `Micro ajustes (7 días):\n${micro.map(m => `- ${m}`).join("\n")}`, 900);
  }

  if (timing.length) {
    await sendLongText(api, waId, `Timing alrededor del entrenamiento:\n${timing.map(t => `- ${t}`).join("\n")}`, 900);
  }

  if (hidr.length) {
    await sendLongText(api, waId, `Hidratación:\n${hidr.map(h => `- ${h}`).join("\n")}`, 900);
  }

  if (accion) await sendLongText(api, waId, `Acción concreta para esta semana:\n${accion}`, 900);
  if (f45) await sendLongText(api, waId, `F45:\n${f45}`, 900);

  if (ant) await sendLongText(api, waId, `Antropometría:\n${ant}`, 900);
  if (der) await sendLongText(api, waId, `Derivación sugerida:\n${der}`, 900);
}

// MAIN HANDLER
export async function handleNutritionMessage(api, waId, text, { LOG_LEVEL } = {}) {
  const level = LOG_LEVEL || LOG_LEVEL_DEFAULT;

  const state = getState(waId);

  // menu -> start nutrition
  if (state.flow === "menu") {
    const t = normalizeText(text);

    if (t.includes("nutri") || shouldAutoStartNutrition(text)) {
      state.flow = "nutrition";
      state.nutritionStep = "objective";
      userState.set(waId, state);

      await sendText(api, waId,
        "Perfecto. Arranquemos el onboarding nutricional F45.\n\nPaso 1: ¿Cuál es tu objetivo principal?\nA) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\nRespondé con la letra (A-E) o con una frase (ej: 'bajar grasa')."
      );
      return;
    }

    await sendLongText(api, waId, formatMenuText(), 900);
    return;
  }

  if (state.flow !== "nutrition") {
    state.flow = "nutrition";
    state.nutritionStep = state.nutritionStep || "objective";
  }

  const step = state.nutritionStep;

  if (step === "objective") {
    const obj = parseObjective(text);
    if (!obj) {
      await sendText(api, waId,
        "Para ubicarte bien, decime tu objetivo principal:\nA) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\nPodés responder con A-E o con una frase (ej: 'ganar músculo')."
      );
      return;
    }
    state.nutritionProfile.objective = obj;
    state.nutritionStep = "base_weight";
    userState.set(waId, state);
    await sendText(api, waId, "Paso 2/2 (Datos base). Primero: ¿cuánto pesás en kg? (ej: 72 o 72.5)");
    return;
  }

  if (step === "base_weight") {
    const w = parseWeightKg(text);
    if (!w) {
      await sendText(api, waId, "No pude leer el peso. Pasame un número en kg (ej: 72 o 72.5).");
      return;
    }
    state.nutritionProfile.weightKg = w;
    state.nutritionStep = "base_height";
    userState.set(waId, state);
    await sendText(api, waId, "¿Tu altura? (podés poner 175 o 1.75)");
    return;
  }

  if (step === "base_height") {
    const h = parseHeightCm(text);
    if (!h) {
      await sendText(api, waId, "No pude leer la altura. Pasame 175 o 1.75.");
      return;
    }
    state.nutritionProfile.heightCm = h;
    state.nutritionStep = "base_age";
    userState.set(waId, state);
    await sendText(api, waId, "¿Edad? (solo número, ej: 29)");
    return;
  }

  if (step === "base_age") {
    const age = parseAge(text);
    if (!age) {
      await sendText(api, waId, "No pude leer la edad. Pasame un número entre 10 y 100 (ej: 29).");
      return;
    }
    state.nutritionProfile.age = age;
    state.nutritionStep = "base_sex";
    userState.set(waId, state);
    await sendText(api, waId, "¿Sexo? (masculino / femenino / no binario / prefiero no decir)");
    return;
  }

  if (step === "base_sex") {
    const sx = parseSex(text);
    if (!sx) {
      await sendText(api, waId, "Decime: masculino / femenino / no binario / prefiero no decir.");
      return;
    }
    state.nutritionProfile.sex = sx;
    state.nutritionStep = "base_anthro";
    userState.set(waId, state);
    await sendText(api, waId, "¿Cuándo fue tu última Antropometría? (ej: 'hace 3 semanas', 'enero 2026', o 'no tengo')");
    return;
  }

  if (step === "base_anthro") {
    state.nutritionProfile.lastAnthro = text.trim();
    if (saysNoAnthro(text)) state.nutritionProfile.flags.suggestAnthroIn7Days = true;
    state.nutritionStep = "base_bf";
    userState.set(waId, state);
    await sendText(api, waId, "¿Sabés tu % de grasa? (si no, respondé 'no')");
    return;
  }

  if (step === "base_bf") {
    const t = normalizeText(text);
    if (!(t === "no" || t === "nop" || t === "no se" || t === "no sé" || t === "nose")) {
      const bf = parseBodyFatPercent(text);
      if (!bf) {
        await sendText(api, waId, "Si lo sabés, pasame un número (ej: 18 o 22.5). Si no, respondé 'no'.");
        return;
      }
      state.nutritionProfile.bodyFatPercent = bf;
    }

    state.nutritionStep = "analysis";
    userState.set(waId, state);

    await sendText(
      api,
      waId,
      "Perfecto ✅ Onboarding completo.\n\nAhora, para afinar el plan, respondeme estas preguntas rápidas (en un solo mensaje si podés):\n" +
      "1) ¿Cuánta proteína dirías que comés por día? (baja/media/alta o ejemplos)\n" +
      "2) ¿Cuánta agua tomás por día?\n" +
      "3) ¿Alcohol? (nunca / 1-2 veces semana / más)\n" +
      "4) ¿Tenés hambre o picoteo nocturno?\n" +
      "5) ¿Cómo llegás al entrenamiento: con energía o sin energía?"
    );
    return;
  }

  if (step === "analysis") {
    state.nutritionProfile.analysisNotes = text.trim();
    state.nutritionStep = "done";
    userState.set(waId, state);

    await sendText(api, waId, "Genial. Con todo esto ya puedo armarte un plan de acción inicial para esta semana ✅");
    await sendText(api, waId, "Acá va tu plan inicial (7 días):");

    const planObj = await askGeminiJsonWithRetry(buildNutritionJsonPlanPrompt(state.nutritionProfile), level);
    if (!planObj) {
      await sendText(api, waId, "Tuve un problema generando el plan. Probemos de nuevo: respondé 'reintentar plan'.");
      return;
    }

    await sendPlanInSections(api, waId, planObj);
    return;
  }

  await sendLongText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.", 900);
}
