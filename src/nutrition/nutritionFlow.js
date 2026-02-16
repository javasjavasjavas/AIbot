import { sendText } from "../whatsapp.js";

import { getState } from "./state.js";
import {
  normalizeText, parseObjective, parseWeightKg, parseHeightCm, parseAge, parseSex,
  parseBodyFatPercent, saysNoAnthro, objectiveLabel
} from "./parsers.js";

import { cleanStr, cleanList } from "./sanitize.js";
import { buildDeterministicDiagnosis, recommendedMealsPerDay } from "./signals.js";
import { getPlanJson } from "./geminiClient.js";
import { buildMetaPrompt, buildDayPrompt } from "./prompts.js";
import { validateDayPlan } from "./validation.js";
import { sendPlanDetailed } from "./sender.js";

// ENV
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

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

export async function handleNutritionMessage(api, waId, text) {
  const state = getState(waId);

  // Arranque desde menú
  if (state.flow === "menu") {
    const t = normalizeText(text);
    if (t.includes("nutri") || shouldAutoStartNutrition(text)) {
      state.flow = "nutrition";
      state.nutritionStep = "objective";

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

    await sendText(api, waId, "Genial. Con todo esto ya puedo armarte un plan de acción inicial para esta semana ✅");
    await sendText(api, waId, "Acá va tu plan inicial (7 días). Te lo mando por partes para que se vea completo:");

    // META
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
        lista_compras: ["pollo", "huevos", "atún", "yogur griego", "arroz", "papa", "avena", "frutas", "verduras", "aceite de oliva"],
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
      `🧠 *Diagnóstico breve:*\n${diag}\n\n` +
      `🎯 *Targets diarios (aprox):* ${targets.kcal} kcal | *P* ${targets.proteina_g}g  *C* ${targets.carbos_g}g  *G* ${targets.grasas_g}g\n` +
      `🍽️ *Comidas por día sugeridas:* ${mealsPerDay}\n` +
      (pri.length ? `\n✅ *Prioridades (semana):*\n- ${pri.join("\n- ")}` : "") +
      `\n\n_(Nota: macros/calorías son aproximados.)_`
    );

    // 7 días con reintentos
    const plan_7_dias = [];
    for (let d = 1; d <= 7; d++) {
      const expectedMeals = mealsPerDay;
      let dayObj = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        const dayPrompt = buildDayPrompt(state.nutritionProfile, { ...meta, comidas_por_dia: expectedMeals }, d);

        try {
          dayObj = await getPlanJson(dayPrompt, { requireKeys: ["dia", "comidas", "total_dia"] });
        } catch (e) {
          if (LOG_LEVEL === "debug") console.error(`❌ Day ${d} attempt ${attempt} error:`, e?.message || e);
          dayObj = null;
        }

        const v = validateDayPlan(dayObj, expectedMeals);
        if (v.ok) break;

        if (LOG_LEVEL === "debug") console.error(`⚠️ Day ${d} inválido (attempt ${attempt}): ${v.reason}`);
        dayObj = null;
      }

      if (dayObj) plan_7_dias.push(dayObj);
    }

    const planObj = {
      diagnostico_breve: diag,
      plan_7_dias,
      lista_compras: meta.lista_compras || [],
      sugerir_antropometria: meta.sugerir_antropometria ?? null,
      derivacion: meta.derivacion ?? null
    };

    await sendPlanDetailed(api, waId, planObj, state.nutritionProfile);
    return;
  }

  await sendText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.");
}
