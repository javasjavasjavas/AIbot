import fs from "node:fs";
import path from "node:path";
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
  if (wants && goals.some(g => t.includes(g))) return true;

  return false;
}

// NUTRITION SYSTEM PROMPT
const NUTRITION_SYSTEM_PATH = path.join(process.cwd(), "nutricion-system.md");
let NUTRITION_SYSTEM_PROMPT = "";

function logInfo(level, ...args) { if (level !== "quiet") console.log(...args); }
function logError(level, ...args) { console.error(...args); }

function loadNutritionSystemPrompt(level) {
  try {
    if (!fs.existsSync(NUTRITION_SYSTEM_PATH)) {
      NUTRITION_SYSTEM_PROMPT = "";
      logError(level, "❌ No se encontró nutricion-system.md en:", NUTRITION_SYSTEM_PATH);
      return;
    }
    NUTRITION_SYSTEM_PROMPT = fs.readFileSync(NUTRITION_SYSTEM_PATH, "utf-8").trim();
    NUTRITION_SYSTEM_PROMPT = NUTRITION_SYSTEM_PROMPT.replace(/InBody/gi, "Antropometría");
    logInfo(level, "🧠 nutricion-system.md cargado OK. chars:", NUTRITION_SYSTEM_PROMPT.length);
  } catch (e) {
    NUTRITION_SYSTEM_PROMPT = "";
    logError(level, "❌ Error cargando nutricion-system.md:", e?.message || e);
  }
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

// GEMINI
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

async function callGemini(prompt, { responseMimeType, maxOutputTokens = 900, temperature = 0.3 } = {}) {
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

async function repairJsonWithGemini(badJsonText) {
  const prompt = `
Devolvé SOLO JSON VÁLIDO (sin markdown, sin texto extra).
Repará este JSON roto/incompleto manteniendo el mismo esquema y el contenido lo más fiel posible:

${badJsonText}
`.trim();

  const fixed = await callGemini(prompt, {
    responseMimeType: "application/json",
    temperature: 0.0,
    maxOutputTokens: 600
  });

  return fixed;
}

async function askGeminiJsonWithRetry(prompt, level, maxAttempts = 3) {
  let lastRaw = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await callGemini(prompt, {
        responseMimeType: "application/json",
        temperature: 0.0,
        maxOutputTokens: 700
      });

      lastRaw = raw;

      const obj = safeJsonParse(raw);
      if (obj) return obj;

      const repairedRaw = await repairJsonWithGemini(raw);
      const repairedObj = safeJsonParse(repairedRaw);
      if (repairedObj) return repairedObj;

      logError(level, "⚠️ JSON no parseable. Intento:", attempt, "raw head:", raw.slice(0, 200));
    } catch (e) {
      const code = e?.code;
      if (code === 429 && attempt < maxAttempts) {
        const retryS = extractRetryDelaySeconds(e?.data?.error) ?? (8 * attempt);
        logError(level, "⚠️ Gemini 429 (json). Reintento en", retryS, "s");
        await sleep((retryS + 1) * 1000);
        continue;
      }
      logError(level, "❌ Gemini json error:", e?.message || e);
    }
  }

  logError(level, "❌ JSON plan failed after retries. lastRaw head:", (lastRaw || "").slice(0, 200));
  return null;
}

// PROMPT + FORMAT
function buildNutritionJsonPlanPrompt(profile) {
  const sys = (NUTRITION_SYSTEM_PROMPT || "").trim();

  return `
${sys}

Contexto del usuario (onboarding F45):
- Objetivo: ${profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido"}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- % grasa (si sabe): ${profile.bodyFatPercent ?? "N/A"}
- Respuestas análisis nutricional: ${profile.analysisNotes ?? "N/A"}
- Flag sugerir Antropometría en 7 días: ${profile.flags?.suggestAnthroIn7Days ? "SI" : "NO"}

Tarea:
Genera un plan inicial para 7 días.

Salida:
DEVOLVÉ SOLO JSON VÁLIDO, sin texto extra, sin markdown, sin comentarios.

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
- Todo debe ser corto y accionable.
- micro_ajustes: 3 a 6 ítems.
- timing_entreno: 1 a 2 ítems.
- hidratacion: 1 a 2 ítems.
`.trim();
}

function formatPlanFromJson(obj) {
  const lines = [];
  const diag = obj?.diagnostico_breve || "";
  const micro = Array.isArray(obj?.micro_ajustes) ? obj.micro_ajustes.filter(Boolean) : [];
  const timing = Array.isArray(obj?.timing_entreno) ? obj.timing_entreno.filter(Boolean) : [];
  const hidr = Array.isArray(obj?.hidratacion) ? obj.hidratacion.filter(Boolean) : [];
  const accion = obj?.accion_semana || "";
  const f45 = obj?.recordatorio_f45 || "";
  const ant = obj?.sugerir_antropometria || "";
  const der = obj?.derivacion || "";

  if (diag) {
    lines.push("Diagnóstico breve:");
    lines.push(diag);
    lines.push("");
  }

  if (micro.length) {
    lines.push("Micro ajustes concretos:");
    for (const m of micro) lines.push(`- ${m}`);
    lines.push("");
  }

  if (timing.length) {
    lines.push("Timing alrededor del entrenamiento:");
    for (const t of timing) lines.push(`- ${t}`);
    lines.push("");
  }

  if (hidr.length) {
    lines.push("Hidratación:");
    for (const h of hidr) lines.push(`- ${h}`);
    lines.push("");
  }

  if (accion) {
    lines.push("Acción concreta para esta semana:");
    lines.push(accion);
    lines.push("");
  }

  if (f45) {
    lines.push("F45:");
    lines.push(f45);
    lines.push("");
  }

  if (ant) {
    lines.push("Antropometría:");
    lines.push(ant);
    lines.push("");
  }

  if (der) {
    lines.push("Derivación sugerida:");
    lines.push(der);
    lines.push("");
  }

  return lines.join("\n").trim();
}

// MAIN HANDLER
export async function handleNutritionMessage(api, waId, text, { LOG_LEVEL } = {}) {
  const level = LOG_LEVEL || LOG_LEVEL_DEFAULT;
  loadNutritionSystemPrompt(level);

  const state = getState(waId);

  // Si estamos en menu y pidieron nutrición (o auto)
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

    await sendLongText(api, waId, formatMenuText(), 1400);
    return;
  }

  // Asegurar flow en nutrition
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
      await sendText(api, waId, "Tuve un problema generando el plan completo. Probemos de nuevo: respondé 'reintentar plan'.");
      return;
    }

    const planText = formatPlanFromJson(planObj);
    await sendLongText(api, waId, planText, 1400);
    return;
  }

  await sendLongText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.", 1400);
}
