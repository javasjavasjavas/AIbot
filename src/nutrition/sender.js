import { sendText } from "../whatsapp.js";
import { cleanStr, cleanList } from "./sanitize.js";

const WA_CHUNK_LIMIT = 650;  // más bajo para evitar "Leer más"
const WA_HARD_LIMIT = 1200;

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

function fmtMeal(meal, index) {
  const name = cleanStr(meal?.nombre, 70) || `Comida ${index + 1}`;
  const kcal = num(meal?.kcal);
  const p = num(meal?.proteina_g);
  const c = num(meal?.carbos_g);
  const f = num(meal?.grasas_g);

  const items = Array.isArray(meal?.items)
    ? meal.items
    : Array.isArray(meal?.opciones)
      ? meal.opciones
      : [];

  const safeItems = cleanList(items, 10, 160);

  const header = `${emojiForMeal(name)} ${bold(name)} — ${kcal} kcal | P ${p}g C ${c}g G ${f}g`;
  const body = safeItems.length ? safeItems.map(i => `- ${cleanStr(i, 180)}`).join("\n") : "- (sin items)";

  return `${header}\n${body}`;
}

function fmtDayHeader(dayObj) {
  const dia = num(dayObj?.dia);
  const total = dayObj?.total_dia || {};
  return (
    `📅 ${bold(`Plan nutricional — Día ${dia}`)}\n` +
    `🎯 ${bold("Total día")}: ${num(total.kcal)} kcal | P ${num(total.proteina_g)}g C ${num(total.carbos_g)}g G ${num(total.grasas_g)}g`
  );
}

function chunkByLines(text, limit = WA_CHUNK_LIMIT) {
  const s = cleanStr(text, WA_HARD_LIMIT * 4);
  const lines = s.split("\n");
  const chunks = [];
  let cur = "";

  for (const line of lines) {
    const candidate = cur ? `${cur}\n${line}` : line;
    if (candidate.length <= limit) {
      cur = candidate;
      continue;
    }
    if (cur) chunks.push(cur);

    // si una línea sola es muy larga, cortamos duro
    if (line.length > limit) {
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      cur = "";
    } else {
      cur = line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function sendDay(api, waId, dayObj) {
  const meals = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];

  // ✅ estrategia: 1 mensaje = header, y luego 1 mensaje por comida
  // si una comida excede, la partimos por líneas
  await sendText(api, waId, cleanStr(fmtDayHeader(dayObj), WA_HARD_LIMIT));

  for (let i = 0; i < meals.length; i++) {
    const block = fmtMeal(meals[i], i);
    if (block.length <= WA_CHUNK_LIMIT) {
      await sendText(api, waId, cleanStr(block, WA_HARD_LIMIT));
    } else {
      const parts = chunkByLines(block, WA_CHUNK_LIMIT);
      for (const p of parts) {
        await sendText(api, waId, cleanStr(p, WA_HARD_LIMIT));
      }
    }
  }
}

function formatShoppingList(lista) {
  if (!Array.isArray(lista) || !lista.length) return null;

  // objetos: {categoria,item,cantidad_aprox}
  if (typeof lista[0] === "object" && lista[0] !== null) {
    const grouped = {};
    for (const it of lista) {
      const cat = cleanStr(it?.categoria || "otros", 40).toLowerCase();
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        item: cleanStr(it?.item || "", 80),
        qty: cleanStr(it?.cantidad_aprox || "", 40)
      });
    }

    const order = ["proteinas", "carbohidratos", "frutas_verduras", "lacteos", "grasas", "varios", "otros"];
    const cats = [...new Set([...order.filter(c => grouped[c]), ...Object.keys(grouped)])];

    const lines = [`🛒 ${bold("Lista de compras semanal")}`];
    for (const c of cats) {
      lines.push(`\n${bold(c.replaceAll("_", " ").toUpperCase())}`);
      for (const x of grouped[c]) {
        if (!x.item) continue;
        lines.push(`- ${x.item}${x.qty ? ` (${x.qty})` : ""}`);
      }
    }
    return lines.join("\n").trim();
  }

  // strings legacy
  const clean = cleanList(lista, 40, 120);
  return `🛒 ${bold("Lista de compras semanal")}\n` + clean.map(i => `- ${i}`).join("\n");
}

export async function sendPlanDetailed(api, waId, planObj) {
  const plan = Array.isArray(planObj?.plan_7_dias) ? planObj.plan_7_dias : [];
  if (!plan.length) {
    await sendText(api, waId, "No pude generar el plan completo. Probemos de nuevo.");
    return;
  }

  const byDay = new Map();
  for (const d of plan) {
    const n = num(d?.dia);
    if (n >= 1 && n <= 7 && !byDay.has(n)) byDay.set(n, d);
  }

  for (let d = 1; d <= 7; d++) {
    const dayObj = byDay.get(d);
    if (dayObj) await sendDay(api, waId, dayObj);
  }

  const train = cleanList(planObj?.entrenamiento_complementario, 4, 220);
  if (train.length) {
    await sendText(api, waId, `🏋️ ${bold("Entrenamiento complementario")}:\n- ${train.join("\n- ")}`);
  }

  const shoppingMsg = formatShoppingList(planObj?.lista_compras);
  if (shoppingMsg) {
    const parts = chunkByLines(shoppingMsg, WA_CHUNK_LIMIT);
    for (const p of parts) await sendText(api, waId, cleanStr(p, WA_HARD_LIMIT));
  }

  const ant = cleanStr(planObj?.sugerir_antropometria ?? "", 380);
  const der = cleanStr(planObj?.derivacion ?? "", 380);

  if (ant) await sendText(api, waId, `📏 ${bold("Antropometría")}:\n${ant}`);
  if (der) await sendText(api, waId, `🩺 ${bold("Derivación sugerida")}:\n${der}`);
}
