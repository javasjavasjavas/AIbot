// src/nutrition/sender.js
import { sendText } from "../whatsapp.js";
import { cleanStr, cleanList } from "./sanitize.js";

// ======================
// CONFIG WHATSAPP SAFE
// ======================

const WA_CHUNK_LIMIT = 800;   // límite visual antes de "Leer más"
const WA_HARD_LIMIT = 1200;   // límite máximo seguro por mensaje

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function bold(t) {
  return `*${t}*`;
}

function emojiForMeal(name = "") {
  const t = name.toLowerCase();
  if (t.includes("desay")) return "🍳";
  if (t.includes("media")) return "🥛";
  if (t.includes("alm")) return "🍗";
  if (t.includes("meri") || t.includes("pre")) return "☕";
  if (t.includes("cena")) return "🌙";
  if (t.includes("post")) return "🏋️";
  return "🍽️";
}

// ======================
// FORMATEO DE COMIDAS
// ======================

function fmtMeal(meal, index) {
  const name = cleanStr(meal?.nombre, 60) || `Comida ${index + 1}`;
  const kcal = num(meal?.kcal);
  const p = num(meal?.proteina_g);
  const c = num(meal?.carbos_g);
  const f = num(meal?.grasas_g);

  const items = Array.isArray(meal?.items)
    ? meal.items
    : Array.isArray(meal?.opciones)
      ? meal.opciones
      : [];

  const safeItems = cleanList(items, 8, 150);

  return (
    `${emojiForMeal(name)} ${bold(name)} — ${kcal} kcal | P ${p}g C ${c}g G ${f}g\n` +
    safeItems.map(i => `- ${cleanStr(i, 160)}`).join("\n")
  );
}

function fmtDayHeader(dayObj) {
  const dia = num(dayObj?.dia);
  const total = dayObj?.total_dia || {};

  return (
    `📅 ${bold(`Plan nutricional — Día ${dia}`)}\n` +
    `🎯 ${bold("Total día")}: ${num(total.kcal)} kcal | ` +
    `P ${num(total.proteina_g)}g C ${num(total.carbos_g)}g G ${num(total.grasas_g)}g`
  );
}

// ======================
// CHUNKING (ANTI CORTE)
// ======================

function chunkByBlocks(blocks) {
  const chunks = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length <= WA_CHUNK_LIMIT) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (block.length > WA_CHUNK_LIMIT) {
      // dividir por líneas
      const lines = block.split("\n");
      let sub = "";
      for (const line of lines) {
        const cand = sub ? `${sub}\n${line}` : line;
        if (cand.length <= WA_CHUNK_LIMIT) {
          sub = cand;
        } else {
          if (sub) chunks.push(sub);
          sub = line;
        }
      }
      if (sub) chunks.push(sub);
      current = "";
    } else {
      current = block;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}

async function sendDay(api, waId, dayObj) {
  const meals = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];

  const blocks = [
    fmtDayHeader(dayObj),
    ...meals.map((m, i) => fmtMeal(m, i))
  ];

  const chunks = chunkByBlocks(blocks);

  for (const msg of chunks) {
    await sendText(api, waId, cleanStr(msg, WA_HARD_LIMIT));
  }
}

// ======================
// LISTA DE COMPRAS
// ======================

function formatShoppingList(lista) {
  if (!Array.isArray(lista) || !lista.length) return null;

  // Caso nuevo: objetos con categoria
  if (typeof lista[0] === "object") {
    const grouped = {};

    for (const item of lista) {
      const cat = item.categoria || "otros";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }

    let out = `🛒 ${bold("Lista de compras semanal")}\n`;

    for (const cat of Object.keys(grouped)) {
      out += `\n${bold(cat.toUpperCase())}\n`;
      for (const it of grouped[cat]) {
        out += `- ${it.item}${it.cantidad_aprox ? ` (${it.cantidad_aprox})` : ""}\n`;
      }
    }

    return out.trim();
  }

  // Caso viejo: array de strings
  const clean = cleanList(lista, 40, 120);
  return (
    `🛒 ${bold("Lista de compras semanal")}\n` +
    clean.map(i => `- ${i}`).join("\n")
  );
}

// ======================
// MAIN EXPORT
// ======================

export async function sendPlanDetailed(api, waId, planObj, profile) {
  // 1️⃣ PLAN 7 DÍAS
  const plan = Array.isArray(planObj?.plan_7_dias)
    ? planObj.plan_7_dias
    : [];

  if (!plan.length) {
    await sendText(api, waId, "No pude generar el plan completo. Intentemos nuevamente.");
    return;
  }

  const byDay = new Map();
  for (const d of plan) {
    const n = num(d?.dia);
    if (n >= 1 && n <= 7 && !byDay.has(n)) {
      byDay.set(n, d);
    }
  }

  for (let d = 1; d <= 7; d++) {
    if (byDay.has(d)) {
      await sendDay(api, waId, byDay.get(d));
    }
  }

  // 2️⃣ ENTRENAMIENTO COMPLEMENTARIO
  if (Array.isArray(planObj?.entrenamiento_complementario) &&
      planObj.entrenamiento_complementario.length) {

    const train = cleanList(planObj.entrenamiento_complementario, 4, 220);

    await sendText(
      api,
      waId,
      `🏋️ ${bold("Entrenamiento complementario")}:\n` +
      train.map(t => `- ${t}`).join("\n")
    );
  }

  // 3️⃣ LISTA DE COMPRAS
  const shoppingMsg = formatShoppingList(planObj?.lista_compras);
  if (shoppingMsg) {
    const chunks = chunkByBlocks([shoppingMsg]);
    for (const msg of chunks) {
      await sendText(api, waId, cleanStr(msg, WA_HARD_LIMIT));
    }
  }

  // 4️⃣ ANTROPOMETRÍA / DERIVACIÓN
  if (planObj?.sugerir_antropometria) {
    await sendText(
      api,
      waId,
      `📏 ${bold("Antropometría")}:\n${cleanStr(planObj.sugerir_antropometria, 400)}`
    );
  }

  if (planObj?.derivacion) {
    await sendText(
      api,
      waId,
      `🩺 ${bold("Derivación sugerida")}:\n${cleanStr(planObj.derivacion, 400)}`
    );
  }
}
