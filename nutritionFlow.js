// nutritionFlow.js
// Flow de Nutrición (onboarding + plan) - versión WhatsApp-safe
// Cambios (SIN cambiar flow ni preguntas):
// 1) Generación PRO en 2 fases: META (targets + comidas/día) + 7 días (1 llamada por día)
// 2) Cada día devuelve comidas con ITEMS + CANTIDADES + macros/kcal por comida + totales diarios
// 3) WhatsApp-safe: 1 mensaje por día; si un día se pasa, lo parte en 2
// 4) Mantiene diagnóstico, entrenamiento complementario, lista de compras, antropometría/derivación
// 5) Cubre TODOS los objetivos: A) grasa B) masa C) recomposición D) rendimiento E) salud

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

async function callGemini(prompt, { responseMimeType, maxOutputTokens = 4096, temperature = 0.2 } = {}) {
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

async function getPlanJson(prompt, { requireKeys = [] } = {}) {
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

// ========= RECOMENDACIÓN DE FRECUENCIA (fallback) =========
function recommendedMealsPerDay(profile) {
  const obj = profile.objective;
  const s = inferSignalsFromNotes(profile.analysisNotes);

  let n;
  if (obj === "A") n = 3;      // déficit: simple y saciante
  else if (obj === "B") n = 5; // superávit: repartir volumen/prote
  else if (obj === "C") n = 4; // recomposición: intermedio
  else if (obj === "D") n = 5; // rendimiento: energía + timing
  else n = 3;                  // salud: simple

  if (s.nightHunger) n = Math.max(n, 4);
  if (s.lowEnergy && (obj === "D" || obj === "B")) n = Math.max(n, 5);
  if ((profile.age ?? 0) >= 40) n = Math.max(n, 4);

  if (n < 3) n = 3;
  if (n > 6) n = 6;
  return n;
}

// ========= PROMPTS PRO (META + DÍA) =========
function buildMetaPrompt(profile) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";
  return `
Sos un nutricionista deportivo (no médico). Respuesta 100% en ESPAÑOL. SIN saludos.

Contexto:
- Objetivo: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- % grasa: ${profile.bodyFatPercent ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- Hábitos reportados: ${profile.analysisNotes ?? "N/A"}

Tarea:
1) Definí targets diarios aproximados (kcal, proteína g, carbos g, grasas g) coherentes con el objetivo y el contexto.
2) Elegí comidas_por_dia (3 a 6) razonadas por objetivo + hábitos (poca proteína / poca agua / alcohol / hambre nocturna / baja energía).
3) Indicá prioridades_semana (3-6 bullets) para esta semana (subir proteína, agua, recortar alcohol, timing pre/post entreno).
4) Generá lista_compras 12-20 ítems alineada a esos targets y al objetivo.
5) Si amerita derivación: "derivacion" (string) o null.
6) Recomendar Antropometría cada 4-6 semanas (y si no tiene, sugerí una en 7 días como baseline).

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "diagnostico_breve": "string (2-3 líneas)",
  "targets_diarios": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
  "comidas_por_dia": 0,
  "prioridades_semana": ["...", "..."],
  "lista_compras": ["..."],
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}

Reglas:
- Nada de textos genéricos tipo “si querés decime horarios”.
- No inventes patologías.
- Números aproximados pero coherentes.
`.trim();
}

function buildDayPrompt(profile, meta, day) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";
  const t = meta?.targets_diarios || {};
  const nMeals = meta?.comidas_por_dia || 4;

  return `
Sos un nutricionista deportivo (no médico). Respuesta 100% en ESPAÑOL. SIN saludos.

Usuario:
- Objetivo: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg, Altura: ${profile.heightCm ?? "N/A"} cm, Edad: ${profile.age ?? "N/A"}, Sexo: ${profile.sex ?? "N/A"}
- Hábitos: ${profile.analysisNotes ?? "N/A"}

Targets del día (aprox):
- kcal: ${t.kcal ?? 0}
- proteína_g: ${t.proteina_g ?? 0}
- carbos_g: ${t.carbos_g ?? 0}
- grasas_g: ${t.grasas_g ?? 0}
- comidas_por_dia: ${nMeals}

Tarea:
Generá el DÍA ${day} con EXACTAMENTE ${nMeals} comidas.
Para cada comida:
- nombre (ej: Desayuno / Media mañana / Almuerzo / Merienda / Pre-entreno / Post-entreno / Cena / Snack nocturno)
- "items": 2 a 5 items con cantidades claras (gramos, unidades, cucharadas)
- macros por comida (kcal, proteína_g, carbos_g, grasas_g)
Al final: total_dia con suma aproximada.

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "dia": ${day},
  "total_dia": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
  "comidas": [
    {
      "nombre": "string",
      "items": ["item + cantidad", "item + cantidad"],
      "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0
    }
  ]
}

Reglas:
- Si reporta poca proteína: cada comida debe incluir una fuente proteica clara.
- Si reporta poca agua: incluir 1-2 recordatorios breves dentro de items (ej “Agua 500ml”).
- Si alcohol 3/semana: sugerí 1 alternativa sin alcohol dentro de items en una comida.
- Variá fuentes (pollo/pescado/huevos/legumbres/lácteos) y carbos (arroz/papa/avena/fruta/pan).
- No repitas el mismo día exacto.
`.trim();
}

// ========= FORMATTERS =========
function fmtMeal(meal) {
  const name = cleanStr(meal?.nombre, 40) || "Comida";
  const items = Array.isArray(meal?.items) ? meal.items.map(i => cleanStr(i, 80)).filter(Boolean) : [];
  const kcal = Number(meal?.kcal ?? 0) || 0;
  const p = Number(meal?.proteina_g ?? 0) || 0;
  const c = Number(meal?.carbos_g ?? 0) || 0;
  const f = Number(meal?.grasas_g ?? 0) || 0;

  const itemsLine = items.length ? `Items: ${items.slice(0, 5).join(" / ")}` : "Items: (sin detalle)";
  return `${name} — ${kcal} kcal | P ${p}g C ${c}g G ${f}g\n${itemsLine}`;
}

function splitDayMessageByMeals(header, mealBlocks, maxLen = 1450) {
  const full = `${header}\n\n${mealBlocks.join("\n\n")}`;
  if (full.length <= maxLen) return [full];

  const parts = [];
  let cur = header;
  for (const block of mealBlocks) {
    const candidate = `${cur}\n\n${block}`;
    if (candidate.length > maxLen && cur !== header) {
      parts.push(cur);
      cur = `${header}\n\n${block}`;
    } else {
      cur = candidate;
    }
  }
  if (cur && cur.trim()) parts.push(cur);

  if (parts.length <= 2) return parts;

  const first = parts.slice(0, Math.ceil(parts.length / 2)).join("\n\n");
  const second = parts.slice(Math.ceil(parts.length / 2)).join("\n\n");
  return [first.slice(0, maxLen), second.slice(0, maxLen)];
}

function fmtDay(dayObj) {
  const dia = Number(dayObj?.dia ?? 0) || 0;
  const total = dayObj?.total_dia || {};
  const tk = Number(total?.kcal ?? 0) || 0;
  const tp = Number(total?.proteina_g ?? 0) || 0;
  const tc = Number(total?.carbos_g ?? 0) || 0;
  const tf = Number(total?.grasas_g ?? 0) || 0;

  const comidas = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];
  const blocks = comidas.slice(0, 8).map(fmtMeal);

  const header =
    `Plan nutricional — Día ${dia}\n` +
    `Total día: ${tk} kcal | P ${tp}g C ${tc}g G ${tf}g`;

  return { header, blocks };
}

// ========= ENVÍO DEL PLAN (CORTO, ORDENADO) =========
async function sendPlanDetailed(api, waId, planObj, profile) {
  // 1) Diagnóstico ya se manda antes (META). Si igual viene, lo mostramos si falta.
  let diag = cleanStr(planObj?.diagnostico_breve, 520);
  if (!diag || diag.length < 50) diag = buildDeterministicDiagnosis(profile);

  // si querés mantener el envío acá también, lo dejamos suave (no duplica si ya lo mandaste)
  // (no enviamos diagnóstico acá para evitar duplicación en el handler)

  // 2) Plan 7 días (1 mensaje por día; si excede, 2 mensajes)
  const plan = Array.isArray(planObj?.plan_7_dias) ? planObj.plan_7_dias : [];
  if (!plan.length) {
    await sendText(api, waId,
      "Plan nutricional (7 días):\n" +
      "- No pude generar el detalle completo en este intento.\n" +
      "- Reintentá y debería devolverte comidas con cantidades + macros por día."
    );
  } else {
    const byDay = new Map();
    for (const d of plan) {
      const n = Number(d?.dia ?? 0) || 0;
      if (n >= 1 && n <= 7 && !byDay.has(n)) byDay.set(n, d);
    }

    for (let d = 1; d <= 7; d++) {
      const dayObj = byDay.get(d);
      if (!dayObj) continue;

      const { header, blocks } = fmtDay(dayObj);
      const msgs = splitDayMessageByMeals(header, blocks, 1450);

      if (msgs.length === 1) {
        await sendText(api, waId, cleanStr(msgs[0], 1450));
      } else {
        await sendText(api, waId, cleanStr(`${msgs[0]}\n\n(continúa)`, 1450));
        await sendText(api, waId, cleanStr(`Día ${d} (parte 2)\n\n${msgs[1]}`, 1450));
      }
    }
  }

  // 3) Entrenamiento complementario (2 bullets)
  const train = cleanList(planObj?.entrenamiento_complementario, 2, 160);
  let trainOut = train.length ? train : [];
  if (trainOut.length !== 2) {
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
    } else if (obj === "C") {
      trainOut = [
        "4-5 sesiones/semana. Consistencia + fuerza/progresión como base para recomposición.",
        "Mantené proteína alta y pasos diarios para favorecer balance energético sin extremos."
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

    // 1) META
    const metaPrompt = buildMetaPrompt(state.nutritionProfile);

    let meta = null;
    try {
      meta = await getPlanJson(metaPrompt, { requireKeys: ["targets_diarios", "comidas_por_dia", "lista_compras"] });
    } catch (e) {
      if (LOG_LEVEL === "debug") console.error("❌ Meta error:", e?.message || e);
    }

    if (!meta) {
      meta = {
        diagnostico_breve: buildDeterministicDiagnosis(state.nutritionProfile),
        targets_diarios: { kcal: 2200, proteina_g: 150, carbos_g: 230, grasas_g: 70 },
        comidas_por_dia: recommendedMealsPerDay(state.nutritionProfile),
        prioridades_semana: ["Subir proteína en cada comida", "Aumentar agua diaria", "Reducir alcohol esta semana"],
        lista_compras: [
          "pollo", "huevos", "atún", "carne magra", "yogur griego",
          "arroz", "papa", "avena", "frutas", "verduras variadas",
          "legumbres", "aceite de oliva", "frutos secos", "queso fresco"
        ],
        sugerir_antropometria: state.nutritionProfile.flags.suggestAnthroIn7Days
          ? "Como no tenés medición reciente, hagamos una Antropometría en 7 días para tener baseline."
          : null,
        derivacion: null
      };
    }

    const diag = cleanStr(meta.diagnostico_breve, 520) || buildDeterministicDiagnosis(state.nutritionProfile);
    const pri = cleanList(meta.prioridades_semana, 6, 140);
    const targets = meta.targets_diarios || {};
    const mealsPerDay = Number(meta.comidas_por_dia ?? 0) || recommendedMealsPerDay(state.nutritionProfile);

    await sendText(api, waId,
      `Diagnóstico breve:\n${diag}\n\n` +
      `Targets diarios (aprox): ${targets.kcal} kcal | P ${targets.proteina_g}g C ${targets.carbos_g}g G ${targets.grasas_g}g\n` +
      `Comidas por día sugeridas: ${mealsPerDay}\n` +
      (pri.length ? `\nPrioridades (semana):\n- ${pri.join("\n- ")}` : "") +
      `\n\n(Nota: macros/calorías son aproximados.)`
    );

    // 2) 7 DÍAS (1 llamada por día)
    const plan_7_dias = [];
    for (let d = 1; d <= 7; d++) {
      const dayPrompt = buildDayPrompt(state.nutritionProfile, { ...meta, comidas_por_dia: mealsPerDay }, d);
      let dayObj = null;

      try {
        dayObj = await getPlanJson(dayPrompt, { requireKeys: ["dia", "comidas", "total_dia"] });
      } catch (e) {
        if (LOG_LEVEL === "debug") console.error(`❌ Day ${d} error:`, e?.message || e);
      }

      if (dayObj) plan_7_dias.push(dayObj);
    }

    const planObj = {
      diagnostico_breve: diag,
      plan_7_dias,
      entrenamiento_complementario: [],
      lista_compras: meta.lista_compras || [],
      sugerir_antropometria: meta.sugerir_antropometria ?? null,
      derivacion: meta.derivacion ?? null
    };

    await sendPlanDetailed(api, waId, planObj, state.nutritionProfile);
    return;
  }

  await sendText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.");
}
