import { sendText } from "./whatsapp.js";

// ENV
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

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
        flags: { suggestAnthroIn7Days: false }
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
      flags: { suggestAnthroIn7Days: false }
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

export function isMenuCommand(text) {
  const t = normalizeText(text);
  return (
    t === "menu" ||
    t === "menú" ||
    t === "inicio" ||
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

// ========= PARSERS =========
function parseObjective(text) {
  const t = normalizeText(text);
  if (["a", "b", "c", "d", "e"].includes(t)) return t.toUpperCase();
  if (t.includes("grasa") || t.includes("bajar") || t.includes("perder peso") || t.includes("definir")) return "A";
  if (t.includes("masa") || t.includes("musculo") || t.includes("músculo") || t.includes("volumen")) return "B";
  if (t.includes("recompos")) return "C";
  if (t.includes("rendimiento") || t.includes("performance") || t.includes("energia") || t.includes("energía")) return "D";
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
  if (t.includes("hombre") || t.includes("masculino") || t === "m") return "masculino";
  if (t.includes("mujer") || t.includes("femenino") || t === "f") return "femenino";
  if (t.includes("no bin") || t.includes("nb")) return "no_binario";
  if (t.includes("prefiero") || t.includes("no decir")) return "no_especifica";
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

// ========= SANITIZE (CLAVE) =========
function cleanStr(x, max = 500) {
  const s = String(x ?? "")
    .replace(/\u0000/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
    .replace(/\r/g, "")
    .trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) : s;
}

function cleanList(arr, maxItems = 6, maxItemLen = 140) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const s = cleanStr(it, maxItemLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ========= GEMINI JSON =========
async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
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
    throw err;
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function getPlanJson(prompt) {
  // intento 1
  const raw1 = await callGemini(prompt, { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 650 });
  const obj1 = safeJsonParse(raw1);
  if (obj1) return obj1;

  // intento 2 (reparación)
  const raw2 = await callGemini(
    `Devolvé SOLO JSON VÁLIDO (sin texto extra). Repará este JSON:\n\n${raw1}`,
    { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 650 }
  );
  const obj2 = safeJsonParse(raw2);
  if (obj2) return obj2;

  return null;
}

function buildPlanPrompt(profile) {
  return `
Sos el Asistente Nutricional Oficial de F45.
Estilo: técnico, claro, motivador. SIN saludos.

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

DEVOLVÉ SOLO JSON VÁLIDO (sin texto extra, sin markdown) con este esquema:
{
  "diagnostico_breve": "string (2-3 líneas)",
  "micro_ajustes": ["string"...],
  "timing_entreno": ["string"...],
  "hidratacion": ["string"...],
  "accion_semana": "string (1 línea)",
  "recordatorio_f45": "string (1-2 líneas)",
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}

Límites:
- micro_ajustes: 3-5 ítems, máx 140 caracteres cada uno
- timing_entreno: 1-2 ítems
- hidratacion: 1-2 ítems
`.trim();
}

async function sendPlanDeterministic(api, waId, planObj) {
  const diag = cleanStr(planObj?.diagnostico_breve, 380);

  const micro = cleanList(planObj?.micro_ajustes, 5, 140);
  const timing = cleanList(planObj?.timing_entreno, 2, 140);
  const hidr = cleanList(planObj?.hidratacion, 2, 140);

  const accion = cleanStr(planObj?.accion_semana, 160);
  const f45 = cleanStr(planObj?.recordatorio_f45, 220);
  const ant = cleanStr(planObj?.sugerir_antropometria ?? "", 220);
  const der = cleanStr(planObj?.derivacion ?? "", 220);

  // Mensajes CORTOS y garantizados (< 900 siempre)
  await sendText(api, waId, `Diagnóstico breve:\n${diag || "Con los datos actuales, el foco es ordenar proteína, hidratación y energía pre-entreno para sostener tu objetivo."}`);

  await sendText(api, waId,
    `Micro ajustes (7 días):\n` +
    (micro.length ? micro.map(m => `- ${m}`).join("\n") : "- Agregá 1 fuente de proteína en cada comida\n- Sumá 2 vasos de agua más por día\n- Reducí alcohol a 1-2 veces/semana")
  );

  if (timing.length) {
    await sendText(api, waId, `Timing entrenamiento:\n${timing.map(t => `- ${t}`).join("\n")}`);
  }

  if (hidr.length) {
    await sendText(api, waId, `Hidratación:\n${hidr.map(h => `- ${h}`).join("\n")}`);
  }

  await sendText(api, waId, `Acción concreta para esta semana:\n${accion || "Elegí 1 comida del día y dejala “perfecta” (proteína + verduras + carbohidrato según entrenamiento) durante 7 días."}`);

  await sendText(api, waId, `F45:\n${f45 || "Mantené 3+ sesiones/semana. La consistencia manda: intensidad + recuperación + hábitos."}`);

  if (ant) await sendText(api, waId, `Antropometría:\n${ant}`);
  if (der) await sendText(api, waId, `Derivación sugerida:\n${der}`);
}

// ========= MAIN =========
export async function handleNutritionMessage(api, waId, text) {
  const state = getState(waId);

  if (state.flow === "menu") {
    const t = normalizeText(text);
    if (t.includes("nutri") || shouldAutoStartNutrition(text)) {
      state.flow = "nutrition";
      state.nutritionStep = "objective";
      userState.set(waId, state);

      await sendText(api, waId,
        "Perfecto. Arranquemos el onboarding nutricional F45.\n\nPaso 1: ¿Cuál es tu objetivo principal?\nA) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\nRespondé con A-E o con una frase (ej: 'bajar grasa')."
      );
      return;
    }

    await sendText(api, waId, formatMenuText());
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
      await sendText(api, waId, "Decime tu objetivo: A) bajar grasa B) ganar músculo C) recomposición D) rendimiento E) salud general");
      return;
    }
    state.nutritionProfile.objective = obj;
    state.nutritionStep = "base_weight";
    userState.set(waId, state);
    await sendText(api, waId, "Paso 2/2 (Datos base). ¿Cuánto pesás en kg? (ej: 72 o 72.5)");
    return;
  }

  if (step === "base_weight") {
    const w = parseWeightKg(text);
    if (!w) { await sendText(api, waId, "Peso inválido. Pasame un número en kg (ej: 72 o 72.5)."); return; }
    state.nutritionProfile.weightKg = w;
    state.nutritionStep = "base_height";
    userState.set(waId, state);
    await sendText(api, waId, "¿Altura? (175 o 1.75)");
    return;
  }

  if (step === "base_height") {
    const h = parseHeightCm(text);
    if (!h) { await sendText(api, waId, "Altura inválida. Pasame 175 o 1.75."); return; }
    state.nutritionProfile.heightCm = h;
    state.nutritionStep = "base_age";
    userState.set(waId, state);
    await sendText(api, waId, "¿Edad? (solo número)");
    return;
  }

  if (step === "base_age") {
    const age = parseAge(text);
    if (!age) { await sendText(api, waId, "Edad inválida. Pasame un número (ej: 29)."); return; }
    state.nutritionProfile.age = age;
    state.nutritionStep = "base_sex";
    userState.set(waId, state);
    await sendText(api, waId, "¿Sexo? (masculino / femenino / no binario / prefiero no decir)");
    return;
  }

  if (step === "base_sex") {
    const sx = parseSex(text);
    if (!sx) { await sendText(api, waId, "Decime: masculino / femenino / no binario / prefiero no decir."); return; }
    state.nutritionProfile.sex = sx;
    state.nutritionStep = "base_anthro";
    userState.set(waId, state);
    await sendText(api, waId, "¿Cuándo fue tu última Antropometría? (ej: 'hace 3 semanas' o 'no tengo')");
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
    if (!(t === "no" || t === "no se" || t === "no sé" || t === "nose")) {
      const bf = parseBodyFatPercent(text);
      if (!bf) { await sendText(api, waId, "Si lo sabés, pasame un número (ej: 18 o 22.5). Si no, 'no'."); return; }
      state.nutritionProfile.bodyFatPercent = bf;
    }
    state.nutritionStep = "analysis";
    userState.set(waId, state);

    await sendText(api, waId,
      "Perfecto ✅ Onboarding completo.\n\nAhora, para afinar el plan, respondeme en un solo mensaje:\n" +
      "1) Proteína diaria (baja/media/alta o ejemplos)\n" +
      "2) Agua por día\n" +
      "3) Alcohol (nunca / 1-2 veces semana / más)\n" +
      "4) Hambre o picoteo nocturno\n" +
      "5) Energía al entrenar (con/sin energía)"
    );
    return;
  }

  if (step === "analysis") {
    state.nutritionProfile.analysisNotes = text.trim();
    state.nutritionStep = "done";
    userState.set(waId, state);

    await sendText(api, waId, "Genial. Con todo esto ya puedo armarte un plan de acción inicial para esta semana ✅");
    await sendText(api, waId, "Acá va tu plan inicial (7 días):");

    const prompt = buildPlanPrompt(state.nutritionProfile);

    let planObj = null;
    try {
      planObj = await getPlanJson(prompt);
    } catch (e) {
      if (LOG_LEVEL === "debug") console.error("❌ Plan error:", e?.message || e);
    }

    if (!planObj) {
      // fallback para no quedarse colgado
      planObj = {
        diagnostico_breve: "Tu objetivo requiere ajustar proteína, hidratación y energía pre-entreno. La prioridad es mejorar adherencia con micro ajustes sostenibles.",
        micro_ajustes: [
          "Sumá 1 porción de proteína en desayuno y cena (huevos, yogur griego, pollo, atún, legumbres).",
          "Agua: llevá una botella y asegurá +2 vasos/día esta semana.",
          "Alcohol: bajá a 1-2 veces/semana y evitá cerca del entreno.",
          "Pre-entreno: 60-90 min antes agregá carbohidrato + proteína (banana + yogur / tostada + jamón).",
          "Nocturno: si hay hambre, planificá snack proteico (yogur/queso/caseína) y cená con más volumen (verduras)."
        ],
        timing_entreno: ["Si entrenás tarde, evitá llegar en ayunas: snack 60-90 min antes."],
        hidratacion: ["Objetivo base: 2 litros/día (más si transpirás mucho)."],
        accion_semana: "Elegí 1 comida al día y hacela “perfecta” por 7 días (proteína + verduras + carbohidrato según entreno).",
        recordatorio_f45: "Mantené 3+ sesiones/semana. Consistencia > perfección.",
        sugerir_antropometria: state.nutritionProfile.flags.suggestAnthroIn7Days ? "Como no tenés medición reciente, hagamos una Antropometría en 7 días para tener baseline." : null,
        derivacion: null
      };
    }

    await sendPlanDeterministic(api, waId, planObj);
    return;
  }

  await sendText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.");
}
