import { sendText, sendLongText } from "../whatsapp.js";

import { getState } from "./state.js";
import {
  normalizeText,
  parseObjective,
  parseWeightKg,
  parseHeightCm,
  parseAge,
  parseSex,
  parseBodyFatPercent,
  saysNoAnthro,
  objectiveLabel
} from "./parsers.js";

import { cleanStr, cleanList } from "./sanitize.js";
import { buildDeterministicDiagnosis, recommendedMealsPerDay } from "./signals.js";
import { getPlanJson } from "./geminiClient.js";
import { buildMetaPrompt, buildDayPrompt } from "./prompts.js";
import { validateDayPlan } from "./validation.js";

// ======================
// MENU HELPERS (export)
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

  const wants = t.includes("quiero") || t.includes("necesito") || t.includes("me gustaria") || t.includes("me gustaría");
  const goals = ["bajar", "perder", "definir", "marcar", "volumen", "musculo", "músculo", "rendimiento", "salud"];
  return wants && goals.some(g => t.includes(g));
}

// ======================
// FALLBACK DAY GENERATOR (para no perder días)
// ======================
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function splitWeightsForMeals(n) {
  // pesos de kcal por comida (suma ~1)
  if (n === 3) return [0.30, 0.40, 0.30];
  if (n === 4) return [0.25, 0.30, 0.15, 0.30];
  if (n === 5) return [0.20, 0.12, 0.28, 0.18, 0.22];
  if (n === 6) return [0.18, 0.12, 0.22, 0.12, 0.18, 0.18];
  return Array.from({ length: n }, () => 1 / n);
}

function namesForMeals(n) {
  if (n === 3) return ["Desayuno", "Almuerzo", "Cena"];
  if (n === 4) return ["Desayuno", "Almuerzo", "Merienda / Pre-entreno", "Cena"];
  if (n === 5) return ["Desayuno", "Media mañana", "Almuerzo", "Merienda / Pre-entreno", "Cena"];
  if (n === 6) return ["Desayuno", "Media mañana", "Almuerzo", "Merienda", "Pre/Post-entreno", "Cena"];
  return Array.from({ length: n }, (_, i) => `Comida ${i + 1}`);
}

function round10(x) { return Math.round(x / 10) * 10; }

function makeFallbackDay(profile, meta, day) {
  const targets = meta?.targets_diarios || { kcal: 2200, proteina_g: 150, carbos_g: 230, grasas_g: 70 };
  const n = clamp(Number(meta?.comidas_por_dia ?? 4) || 4, 3, 6);

  const weights = splitWeightsForMeals(n);
  const mealNames = namesForMeals(n);

  // Rotación simple para variedad
  const proteins = ["pechuga de pollo", "huevos", "atún", "carne magra", "merluza", "yogur griego", "lentejas"];
  const carbs = ["arroz", "papa/batata", "avena", "pan integral", "quinoa", "fideos", "legumbres"];
  const vegs = ["brócoli", "ensalada mixta", "zanahoria", "espinaca", "tomate", "zucchini", "morrones"];
  const fats = ["aceite de oliva", "palta", "nueces/almendras", "maní", "semillas"];

  const meals = [];
  for (let i = 0; i < n; i++) {
    const w = weights[i];

    const kcal = Math.round(targets.kcal * w);
    const p = Math.max(15, Math.round(targets.proteina_g * (0.9 * w + 0.1 / n)));
    const c = Math.max(15, Math.round(targets.carbos_g * (0.95 * w + 0.05 / n)));
    const f = Math.max(6, Math.round(targets.grasas_g * (0.95 * w + 0.05 / n)));

    const prot = proteins[(day + i) % proteins.length];
    const carb = carbs[(day + i * 2) % carbs.length];
    const veg = vegs[(day + i * 3) % vegs.length];
    const fat = fats[(day + i * 4) % fats.length];

    // cantidades simples (aprox) para que no sea “genérico sin gramos”
    const protQty = prot === "huevos" ? `${clamp(Math.round(p / 10), 2, 4)} unidades` : `${round10(clamp(p * 4, 120, 220))} g`;
    const carbQty = `${round10(clamp(c * 3, 80, 220))} g (cocido)`;
    const vegQty = `${round10(clamp(150 + i * 20, 150, 250))} g`;
    const fatQty = fat.includes("aceite") ? "1 cda (10 ml)" : "20 g";

    const items = [
      `${prot}: ${protQty}`,
      `${carb}: ${carbQty}`,
      `${veg}: ${vegQty}`,
      `${fat}: ${fatQty}`
    ];

    // hábitos: agua / alcohol
    const notes = normalizeText(profile?.analysisNotes || "");
    if (notes.includes("poca agua") || notes.includes("tomo poca")) {
      if (i === 0 || i === Math.floor(n / 2)) items.push("Agua: 500 ml");
    }
    if (notes.includes("alcohol") && i === n - 1) {
      items.push("Alternativa sin alcohol: agua con gas + limón");
    }

    meals.push({
      nombre: mealNames[i],
      items,
      kcal,
      proteina_g: p,
      carbos_g: c,
      grasas_g: f
    });
  }

  // totales aproximados desde comidas
  const total = meals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + (Number(m.kcal) || 0),
      proteina_g: acc.proteina_g + (Number(m.proteina_g) || 0),
      carbos_g: acc.carbos_g + (Number(m.carbos_g) || 0),
      grasas_g: acc.grasas_g + (Number(m.grasas_g) || 0)
    }),
    { kcal: 0, proteina_g: 0, carbos_g: 0, grasas_g: 0 }
  );

  return {
    dia: day,
    total_dia: {
      kcal: Math.round(total.kcal),
      proteina_g: Math.round(total.proteina_g),
      carbos_g: Math.round(total.carbos_g),
      grasas_g: Math.round(total.grasas_g)
    },
    comidas: meals
  };
}

// ======================
// MAIN HANDLER (export)
// ======================
export async function handleNutritionMessage(api, waId, text, ctx = {}) {
  const state = getState(waId);
  const LOG_LEVEL = ctx.LOG_LEVEL || process.env.LOG_LEVEL || "info";

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

    // ✅ Reemplazo del texto (sin prometer tiempos / espera)
    await sendText(
      api,
      waId,
      "Estamos armando un plan inicial (7 días) a medida de tus necesidades. A continuación te lo envío por partes para que se vea completo:"
    );

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
    const mealsPerDay = clamp(Number(meta.comidas_por_dia ?? 0) || recommendedMealsPerDay(state.nutritionProfile), 3, 6);

    await sendText(api, waId,
      `🧠 *Diagnóstico breve:*\n${diag}\n\n` +
      `🎯 *Targets diarios (aprox):* ${targets.kcal} kcal | *P* ${targets.proteina_g}g  *C* ${targets.carbos_g}g  *G* ${targets.grasas_g}g\n` +
      `🍽️ *Comidas por día sugeridas:* ${mealsPerDay}\n` +
      (pri.length ? `\n✅ *Prioridades (semana):*\n- ${pri.join("\n- ")}` : "") +
      `\n\n_(Nota: macros/calorías son aproximados.)_`
    );

    // 2) 7 DÍAS con reintentos + garantía de 1..7
    const planByDay = new Map();

    for (let d = 1; d <= 7; d++) {
      const expectedMeals = mealsPerDay;
      let dayObj = null;

      // 🔥 subimos a 5 intentos (antes 3) para reducir días faltantes
      for (let attempt = 1; attempt <= 5; attempt++) {
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

      // ✅ Si falló igual, no lo descartamos: generamos un fallback local
      if (!dayObj) {
        dayObj = makeFallbackDay(state.nutritionProfile, { ...meta, comidas_por_dia: expectedMeals }, d);
        if (LOG_LEVEL === "debug") console.error(`ℹ️ Day ${d}: usando fallback local`);
      }

      planByDay.set(d, dayObj);
    }

    // convertir a array ordenado 1..7
    const plan_7_dias = [];
    for (let d = 1; d <= 7; d++) {
      const day = planByDay.get(d);
      if (day) plan_7_dias.push(day);
    }

    // 3) Ensamble final y envío (usa el sender que ya tenés)
    const planObj = {
      diagnostico_breve: diag,
      plan_7_dias,
      entrenamiento_complementario: [],
      lista_compras: meta.lista_compras || [],
      sugerir_antropometria: meta.sugerir_antropometria ?? null,
      derivacion: meta.derivacion ?? null
    };

    // Import dinámico para evitar ciclos si tu proyecto lo armó así.
    // Si ya lo tenías estático, podés volver a importarlo arriba.
    const { sendPlanDetailed } = await import("./sender.js");
    await sendPlanDetailed(api, waId, planObj, state.nutritionProfile);
    return;
  }

  await sendText(api, waId, "Listo. Si querés volver al menú: escribí 'volver al menu principal'.");
}
