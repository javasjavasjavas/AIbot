// nutritionFlow.js
// Flow de Nutrición (onboarding + plan) - versión WhatsApp-safe
// Cambios:
// 1) Diagnóstico breve completo
// 2) Plan nutricional 7 días: ejemplos de comidas por día + macros + calorías (aprox)
// 3) "F45" -> "Entrenamiento complementario"
// 4) Lista de compras basada en el plan
// NOTA: envía en mensajes cortos (1 por día) para evitar cortes.

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

// ========= SANITIZE =========
function cleanStr(x, max = 700) {
  const s = String(x ?? "")
    .replace(/\u0000/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) : s;
}

function cleanList(arr, maxItems = 10, maxItemLen = 220) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const s = cleanStr(it, maxItemLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ========= DIAGNÓSTICO DETERMINÍSTICO (fallback) =========
function inferSignalsFromNotes(notesRaw) {
  const t = normalizeText(notesRaw || "");
  return {
    lowProtein: t.includes("poca prote") || t.includes("baja prote") || t.includes("casi no prote"),
    lowWater: t.includes("poca agua") || t.includes("tomo poca") || t.includes("casi no tomo"),
    highAlcohol: t.includes("alcohol") && (t.includes("3") || t.includes("mas") || t.includes("más") || t.includes("seguido")),
    nightHunger: t.includes("hambre de noche") || t.includes("picoteo nocturno") || t.includes("pico de noche"),
    lowEnergy: t.includes("sin energia") || t.includes("sin energía") || t.includes("llego cansado") || t.includes("me falta energia")
  };
}

function buildDeterministicDiagnosis(profile) {
  const goal = objectiveLabel(profile.objective);
  const s = inferSignalsFromNotes(profile.analysisNotes);

  const focuses = [];
  if (s.lowProtein) focuses.push("subir proteína");
  if (s.lowWater) focuses.push("mejorar hidratación");
  if (s.highAlcohol) focuses.push("reducir alcohol");
  if (s.nightHunger) focuses.push("mejorar saciedad nocturna");
  if (s.lowEnergy) focuses.push("mejorar energía pre-entreno");

  const focusText = focuses.length ? focuses.join(", ") : "ordenar hábitos base (proteína, agua, horarios y calidad)";

  return `Objetivo: ${goal}. A partir de tus respuestas, el foco esta semana es ${focusText}.
Vamos a priorizar adherencia con micro ajustes sostenibles para mejorar composición corporal y rendimiento.`;
}

// ========= GEMINI JSON =========
async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

async function callGemini(prompt, { responseMimeType, maxOutputTokens = 1200, temperature = 0.2 } = {}) {
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
  const raw1 = await callGemini(prompt, { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1200 });
  const obj1 = safeJsonParse(raw1);
  if (obj1) return obj1;

  const raw2 = await callGemini(
    `Devolvé SOLO JSON VÁLIDO (sin texto extra). Repará este JSON:\n\n${raw1}`,
    { responseMimeType: "application/json", temperature: 0.0, maxOutputTokens: 1200 }
  );
  const obj2 = safeJsonParse(raw2);
  if (obj2) return obj2;

  return null;
}

// ========= PROMPT (PLAN 7 DÍAS + COMIDAS + MACROS) =========
function buildPlanPrompt(profile) {
  return `
Sos el Asistente Nutricional Oficial de F45.
Estilo: técnico, claro, motivador. SIN saludos.

Reglas:
- No reemplazas a un nutricionista clínico.
- No prescribes dietas médicas ni tratamientos.
- No haces diagnósticos médicos.
- Trabajas sobre hábitos, distribución de macronutrientes, timing, hidratación, sueño y adherencia.
- Recomendas Antropometría cada 4-6 semanas.
- Si hay condiciones médicas, TCA, embarazo, medicación metabólica o casos complejos: sugerí derivación.
- NO prometas resultados en tiempos exactos.
- NO dietas extremas.

Contexto del usuario:
- Objetivo: ${profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido"}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- % grasa: ${profile.bodyFatPercent ?? "N/A"}
- Hábitos reportados: ${profile.analysisNotes ?? "N/A"}

Tarea:
1) Escribí "diagnostico_breve" (2-3 líneas completas) específico a objetivo + hábitos.
2) Armá un plan nutricional de 7 días con ejemplos de comidas: 3 comidas + 1 snack por día.
   - Para cada comida: nombre + ejemplos breves.
   - Incluir macros y calorías aproximadas por comida: kcal, proteína g, carbos g, grasas g.
   - Incluir totales diarios: kcal y macros.
   - Mantenerlo realista (no perfecto), basado en hábitos declarados.
3) "entrenamiento_complementario": 2 bullets que apoyen el objetivo (sin inventar rutinas clínicas).
4) "lista_compras": lista breve (12-20 ítems) coherente con el plan.

DEVOLVÉ SOLO JSON VÁLIDO con este esquema:
{
  "diagnostico_breve": "string",
  "plan_7_dias": [
    {
      "dia": 1,
      "total_dia": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
      "comidas": [
        {"nombre": "Desayuno", "opciones": ["..."], "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
        {"nombre": "Almuerzo", "opciones": ["..."], "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
        {"nombre": "Snack", "opciones": ["..."], "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
        {"nombre": "Cena", "opciones": ["..."], "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0}
      ]
    }
  ],
  "entrenamiento_complementario": ["...", "..."],
  "lista_compras": ["..."],
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}

Condiciones:
- Los números son estimaciones razonables (no exactitud clínica).
- Si el usuario reportó poca proteína o poca agua: reflejalo en acciones y selección de comidas.
- Plan apto para F45: energía suficiente para entrenar (especialmente si objetivo es rendimiento o masa).
`.trim();
}

// ========= FORMATTERS =========
function fmtMeal(meal) {
  const name = cleanStr(meal?.nombre, 40) || "Comida";
  const opts = Array.isArray(meal?.opciones) ? meal.opciones.map(o => cleanStr(o, 90)).filter(Boolean) : [];
  const kcal = Number(meal?.kcal ?? 0) || 0;
  const p = Number(meal?.proteina_g ?? 0) || 0;
  const c = Number(meal?.carbos_g ?? 0) || 0;
  const f = Number(meal?.grasas_g ?? 0) || 0;

  const optLine = opts.length ? `Opciones: ${opts.slice(0, 2).join(" / ")}` : "Opciones: (ejemplos simples)";

  return `${name} — ${kcal} kcal | P ${p}g C ${c}g G ${f}g\n${optLine}`;
}

function fmtDay(dayObj) {
  const dia = Number(dayObj?.dia ?? 0) || 0;
  const total = dayObj?.total_dia || {};
  const tk = Number(total?.kcal ?? 0) || 0;
  const tp = Number(total?.proteina_g ?? 0) || 0;
  const tc = Number(total?.carbos_g ?? 0) || 0;
  const tf = Number(total?.grasas_g ?? 0) || 0;

  const comidas = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];
  const lines = comidas.slice(0, 4).map(fmtMeal);

  return (
    `Plan nutricional — Día ${dia}\n` +
    `Total día: ${tk} kcal | P ${tp}g C ${tc}g G ${tf}g\n\n` +
    lines.join("\n\n")
  );
}

// ========= ENVÍO DEL PLAN (CORTO, ORDENADO) =========
async function sendPlanDetailed(api, waId, planObj, profile) {
  // 1) Diagnóstico
  let diag = cleanStr(planObj?.diagnostico_breve, 520);
  if (!diag || diag.length < 50) diag = buildDeterministicDiagnosis(profile);

  await sendText(api, waId, `Diagnóstico breve:\n${diag}\n\n(Nota: macros/calorías son aproximados.)`);

  // 2) Plan 7 días (1 mensaje por día)
  const plan = Array.isArray(planObj?.plan_7_dias) ? planObj.plan_7_dias : [];
  if (!plan.length) {
    // fallback mínimo si Gemini no devolvió plan
    await sendText(api, waId,
      "Plan nutricional (7 días):\n" +
      "- Armalo con 3 comidas + 1 snack por día.\n" +
      "- En cada comida: 1 proteína + 1 carbohidrato + 1 vegetal.\n" +
      "- Si querés, decime horarios y preferencias y lo detallamos."
    );
  } else {
    // asegurar días 1..7
    const byDay = new Map();
    for (const d of plan) {
      const n = Number(d?.dia ?? 0) || 0;
      if (n >= 1 && n <= 7 && !byDay.has(n)) byDay.set(n, d);
    }

    for (let d = 1; d <= 7; d++) {
      const dayObj = byDay.get(d);
      if (!dayObj) continue;

      const msg = fmtDay(dayObj);
      // seguridad: no mandar mensajes enormes
      const safeMsg = cleanStr(msg, 1450);
      await sendText(api, waId, safeMsg);
    }
  }

  // 3) Entrenamiento complementario (2 bullets)
  const train = cleanList(planObj?.entrenamiento_complementario, 2, 160);
  let trainOut = train.length ? train : [];
  if (trainOut.length !== 2) {
    // fallback por objetivo
    const obj = profile.objective;
    if (obj === "A") {
      trainOut = [
        "3-5 sesiones/semana. Sumá 2-3 caminatas de 20-30 min para aumentar gasto sin agotarte.",
        "Priorizá sueño (7h+) y evitá entrenar fuerte con hambre extrema: adherencia primero."
      ];
    } else if (obj === "B") {
      trainOut = [
        "4-5 sesiones/semana. Buscá progresar en intensidad y recuperarte (comer + dormir).",
        "Post-entreno: proteína + carbos dentro de 1-2 horas para rendir en la próxima sesión."
      ];
    } else if (obj === "D") {
      trainOut = [
        "4-6 sesiones/semana. Llegá con energía: carbos pre-entreno e hidratación consistente.",
        "En días de fatiga, bajá un punto la intensidad pero mantené la constancia."
      ];
    } else {
      trainOut = [
        "3+ sesiones/semana como base y foco en consistencia.",
        "Dormir e hidratarte bien mejora rendimiento y composición con el tiempo."
      ];
    }
  }

  await sendText(api, waId, `Entrenamiento complementario:\n- ${trainOut[0]}\n- ${trainOut[1]}`);

  // 4) Lista de compras
  const shopping = cleanList(planObj?.lista_compras, 20, 60);
  if (shopping.length) {
    await sendText(api, waId, `Lista de compras (base):\n- ${shopping.join("\n- ")}`);
  }

  // Antropometría / derivación (opcionales)
  const ant = cleanStr(planObj?.sugerir_antropometria ?? "", 260);
  const der = cleanStr(planObj?.derivacion ?? "", 260);

  if (ant) await sendText(api, waId, `Antropometría:\n${ant}`);
  if (der) await sendText(api, waId, `Derivación sugerida:\n${der}`);
}

// ========= MAIN HANDLER =========
export async function handleNutritionMessage(api, waId, text) {
  const state = getState(waId);

  // Arranque desde menú
  if (state.flow === "menu") {
    const t = normalizeText(text);
    if (t.includes("nutri") || shouldAutoStartNutrition(text)) {
      state.flow = "nutrition";
      state.nutritionStep = "objective";
      userState.set(waId, state);

      await sendText(api, waId,
        "Perfecto. Arranquemos el onboarding nutricional F45.\n\nPaso 1: ¿Cuál es tu objetivo principal?\n" +
        "A) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\n" +
        "Respondé con A-E o con una frase (ej: 'bajar grasa')."
      );
      return;
    }

    await sendText(api, waId, formatMenuText());
    return;
  }

  // Garantizar flujo nutrition
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
      "5) Energía al entrenar (con/sin energía)\n\n" +
      "Opcional: ¿alguna preferencia o alimento que no comas?"
    );
    return;
  }

  if (step === "analysis") {
    state.nutritionProfile.analysisNotes = text.trim();
    state.nutritionStep = "done";
    userState.set(waId, state);

    await sendText(api, waId, "Genial. Con todo esto ya puedo armarte un plan de acción inicial para esta semana ✅");
    await sendText(api, waId, "Acá va tu plan inicial (7 días). Te lo mando por partes para que se vea completo:");

    const prompt = buildPlanPrompt(state.nutritionProfile);

    let planObj = null;
    try {
      planObj = await getPlanJson(prompt);
    } catch (e) {
      if (LOG_LEVEL === "debug") console.error("❌ Plan error:", e?.message || e);
    }

    // Fallback si el modelo falla: armamos una estructura simple (sin macros perfectos)
    if (!planObj) {
      planObj = {
        diagnostico_breve: buildDeterministicDiagnosis(state.nutritionProfile),
        plan_7_dias: [], // si querés, acá se puede generar un template fijo
        entrenamiento_complementario: [],
        lista_compras: [
          "pollo o carne magra", "huevos", "atún", "yogur griego",
          "arroz o papa", "avena", "fruta (banana/manzana)", "verduras (hoja/tomate/zanahoria)",
          "legumbres", "aceite de oliva", "frutos secos", "queso fresco"
        ],
        sugerir_antropometria: state.nutritionProfile.flags.suggestAnthroIn7Days
          ? "Como no tenés medición reciente, hagamos una Antropometría en 7 días para tener baseline."
          : null,
        derivacion: null
      };
    }

    await sendPlanDetailed(api, waId, planObj, state.nutritionProfile);
    return;
  }

  await sendText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.");
}
