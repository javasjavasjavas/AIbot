// src/nutrition/nutritionFlow.js
import { sendText } from "../whatsapp.js";

import { getState } from "./state.js";
import {
  normalizeText,
  parseObjective,
  parseWeightKg,
  parseHeightCm,
  parseAge,
  parseSex,
  parseActivityPerWeek,
  parseBodyFatPercent,
  saysNoAnthro
} from "./parsers.js";

import { cleanStr, cleanList } from "./sanitize.js";
import { getPlanJson } from "./geminiClient.js";
import { buildMetaPrompt, buildDayPrompt, buildShoppingPrompt } from "./prompts.js";
import { validateMeta, validateDayPlan } from "./validation.js";
import { sendPlanDetailed } from "./sender.js";

// ======================
// MENU HELPERS (exports)
// ======================
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

  const wants =
    t.includes("quiero") ||
    t.includes("necesito") ||
    t.includes("me gustaria") ||
    t.includes("me gustaría");

  const goals = ["bajar", "perder", "definir", "marcar", "volumen", "musculo", "músculo", "rendimiento", "salud"];
  return wants && goals.some(g => t.includes(g));
}

// ======================
// CONCURRENCY HELPERS
// ======================
async function asyncPool(limit, items, iteratorFn) {
  const ret = [];
  const executing = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);

    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }

  return Promise.allSettled(ret);
}

// ======================
// STRICT GENERATION (NO HARDCODE)
// ======================
async function getMetaStrict(profile) {
  // intentos “normales”
  for (let i = 1; i <= 3; i++) {
    const meta = await getPlanJson(buildMetaPrompt(profile), {
      requireKeys: ["diagnostico_breve", "targets_diarios", "comidas_por_dia", "prioridades_semana"],
      attempts: 2
    });

    const v = validateMeta(meta);
    if (v.ok) return meta;
  }

  // intentos “hard”
  const hardPrompt =
    buildMetaPrompt(profile) +
    "\n\nIMPORTANTE: Ningún valor numérico puede ser 0. Respetá el esquema EXACTO. No agregues campos.";

  const meta2 = await getPlanJson(hardPrompt, {
    requireKeys: ["diagnostico_breve", "targets_diarios", "comidas_por_dia", "prioridades_semana"],
    attempts: 2
  });

  const v2 = validateMeta(meta2);
  if (!v2.ok) throw new Error(`Meta inválida: ${v2.reason}`);

  return meta2;
}

async function getDayStrict(profile, meta, day, mealsPerDay) {
  for (let i = 1; i <= 4; i++) {
    const dayObj = await getPlanJson(
      buildDayPrompt(profile, { ...meta, comidas_por_dia: mealsPerDay }, day),
      { requireKeys: ["dia", "total_dia", "comidas"], attempts: 2 }
    );

    const v = validateDayPlan(dayObj, mealsPerDay);
    if (v.ok) return dayObj;
  }

  const hardPrompt =
    buildDayPrompt(profile, { ...meta, comidas_por_dia: mealsPerDay }, day) +
    "\n\nIMPORTANTE: Ninguna comida ni total puede tener kcal/macros en 0. Total_dia debe ser coherente con la suma. " +
    "Respetá EXACTAMENTE la cantidad de comidas.";

  const last = await getPlanJson(hardPrompt, { requireKeys: ["dia", "total_dia", "comidas"], attempts: 2 });
  const v2 = validateDayPlan(last, mealsPerDay);
  if (!v2.ok) throw new Error(`Día ${day} inválido: ${v2.reason}`);
  return last;
}

// ======================
// MAIN HANDLER (export)
// ======================
export async function handleNutritionMessage(api, waId, text, ctx = {}) {
  const state = getState(waId);
  const LOG_LEVEL = ctx.LOG_LEVEL || process.env.LOG_LEVEL || "info";

  function logDebug(...args) { if (LOG_LEVEL === "debug") console.log(...args); }
  function logError(...args) { console.error(...args); }

  // Arranque desde menú
  if (state.flow === "menu") {
    const t = normalizeText(text);
    if (t.includes("nutri") || shouldAutoStartNutrition(text)) {
      state.flow = "nutrition";
      state.nutritionStep = "objective";

      await sendText(
        api,
        waId,
        "Perfecto. Arranquemos el onboarding nutricional F45.\n\nPaso 1: ¿Cuál es tu objetivo principal?\n" +
          "A) Pérdida de grasa\nB) Ganancia muscular\nC) Recomposición\nD) Rendimiento\nE) Salud general\n\n" +
          "Respondé con A-E o con una frase (ej: 'bajar grasa')."
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
    await sendText(api, waId, "Paso 2/2 (Datos base). ¿Cuánto pesás en kg? (ej: 72 o 72.5)");
    return;
  }

  if (step === "base_weight") {
    const w = parseWeightKg(text);
    if (!w) { await sendText(api, waId, "Peso inválido. Pasame un número en kg (ej: 72 o 72.5)."); return; }
    state.nutritionProfile.weightKg = w;
    state.nutritionStep = "base_height";
    await sendText(api, waId, "¿Altura? (175 o 1.75)");
    return;
  }

  if (step === "base_height") {
    const h = parseHeightCm(text);
    if (!h) { await sendText(api, waId, "Altura inválida. Pasame 175 o 1.75."); return; }
    state.nutritionProfile.heightCm = h;
    state.nutritionStep = "base_age";
    await sendText(api, waId, "¿Edad? (solo número)");
    return;
  }

  if (step === "base_age") {
    const age = parseAge(text);
    if (!age) { await sendText(api, waId, "Edad inválida. Pasame un número (ej: 29)."); return; }
    state.nutritionProfile.age = age;
    state.nutritionStep = "base_sex";
    await sendText(api, waId, "¿Sexo? (masculino / femenino / no binario / prefiero no decir)");
    return;
  }

  if (step === "base_sex") {
    const sx = parseSex(text);
    if (!sx) { await sendText(api, waId, "Decime: masculino / femenino / no binario / prefiero no decir."); return; }
    state.nutritionProfile.sex = sx;

    state.nutritionStep = "base_activity";
    await sendText(api, waId, "¿Hacés actividad física? ¿Cuántas veces por semana? (ej: 0 / 3 / 5)");
    return;
  }

  if (step === "base_activity") {
    const n = parseActivityPerWeek(text);
    if (n === null) { await sendText(api, waId, "Decime un número de veces por semana (0 a 14). Ej: 0 / 3 / 5"); return; }
    state.nutritionProfile.activityPerWeek = n;

    state.nutritionStep = "base_anthro";
    await sendText(api, waId, "¿Cuándo fue tu última Antropometría? (ej: 'hace 3 semanas' o 'no tengo')");
    return;
  }

  if (step === "base_anthro") {
    state.nutritionProfile.lastAnthro = text.trim();
    if (saysNoAnthro(text)) state.nutritionProfile.flags.suggestAnthroIn7Days = true;
    state.nutritionStep = "base_bf";
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

    await sendText(api, waId, "Estamos armando un plan inicial (7 días) a medida de tus necesidades. Te lo enviamos ni bien lo tengamos listo.");

    // 1) META 100% IA
    let meta;
    try {
      meta = await getMetaStrict(state.nutritionProfile);
    } catch (e) {
      // ✅ log real del error para debug
      logError("❌ META failed:", e?.message || e, { code: e?.code, raw: e?.raw ? "(has raw)" : null });
      await sendText(api, waId, "Hubo un problema generando tu diagnóstico/targets. Reintentá en 30 segundos.");
      return;
    }

    const diag = cleanStr(meta?.diagnostico_breve, 700);
    const targets = meta?.targets_diarios || {};
    const mealsPerDay = Math.max(3, Math.min(6, Number(meta?.comidas_por_dia || 4)));
    const pri = cleanList(meta?.prioridades_semana, 6, 220);

    await sendText(
      api,
      waId,
      `🧠 *Diagnóstico breve:*\n${diag}\n\n` +
      `🎯 *Targets diarios (aprox):* ${targets.kcal} kcal | *P* ${targets.proteina_g}g  *C* ${targets.carbos_g}g  *G* ${targets.grasas_g}g\n` +
      `🍽️ *Comidas por día sugeridas:* ${mealsPerDay}\n` +
      (pri.length ? `\n✅ *Prioridades (semana):*\n- ${pri.join("\n- ")}` : "") +
      `\n\n_(Nota: macros/calorías son aproximados.)_`
    );

    // 2) DÍAS 1..7
    const days = [1,2,3,4,5,6,7];
    const settled = await asyncPool(3, days, async (d) => getDayStrict(state.nutritionProfile, meta, d, mealsPerDay));

    const planByDay = new Map();
    settled.forEach((r, idx) => {
      const d = days[idx];
      if (r.status === "fulfilled" && r.value) planByDay.set(d, r.value);
      else logDebug(`⚠️ Day ${d} failed (pool):`, r?.reason?.message || r?.reason);
    });

    const plan_7_dias = [];
    for (const d of days) {
      if (planByDay.has(d)) plan_7_dias.push(planByDay.get(d));
      else {
        try {
          const one = await getDayStrict(state.nutritionProfile, meta, d, mealsPerDay);
          plan_7_dias.push(one);
        } catch (e) {
          logError(`❌ Day ${d} final failed:`, e?.message || e);
          await sendText(api, waId, `No pude generar el Día ${d} con valores consistentes. Reintentá en 30 segundos.`);
          return;
        }
      }
    }

    // 3) Lista compras (del plan real)
    let listaCompras = [];
    try {
      const shopObj = await getPlanJson(buildShoppingPrompt(state.nutritionProfile, meta, plan_7_dias), {
        requireKeys: ["lista_compras"],
        attempts: 2
      });
      listaCompras = Array.isArray(shopObj?.lista_compras) ? shopObj.lista_compras : [];
    } catch (e) {
      logError("❌ Shopping failed:", e?.message || e);
    }

    const planObj = {
      diagnostico_breve: diag,
      plan_7_dias,
      entrenamiento_complementario: meta?.entrenamiento_complementario || [],
      lista_compras: listaCompras,
      sugerir_antropometria: meta?.sugerir_antropometria ?? null,
      derivacion: meta?.derivacion ?? null
    };

    await sendPlanDetailed(api, waId, planObj);
    return;
  }

  await sendText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.");
}
