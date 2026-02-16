import { sendText } from "../whatsapp.js";
import { cleanStr, cleanList } from "./sanitize.js";

// ======================
// Limits (WhatsApp-safe)
// ======================
// Importante: WhatsApp suele mostrar "Leer más" ~700-900 chars dependiendo del cliente.
// Para evitarlo, mantenemos chunks chicos.
const WA_CHUNK_LIMIT = 850;  // probá 780 si todavía aparece "Leer más"
const WA_HARD_LIMIT = 1200;  // seguridad

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function bold(s) { return `*${s}*`; }

function emojiForMeal(name) {
  const t = (name || "").toLowerCase();
  if (t.includes("desay")) return "🍳";
  if (t.includes("media")) return "🥛";
  if (t.includes("alm")) return "🍗";
  if (t.includes("meri") || t.includes("pre")) return "☕";
  if (t.includes("cena")) return "🌙";
  if (t.includes("post")) return "🏋️";
  return "🍽️";
}

function fmtMeal(meal, idx) {
  const name = cleanStr(meal?.nombre, 50) || `Comida ${idx + 1}`;
  const kcal = num(meal?.kcal);
  const p = num(meal?.proteina_g);
  const c = num(meal?.carbos_g);
  const f = num(meal?.grasas_g);
  const items = Array.isArray(meal?.items) ? meal.items : (Array.isArray(meal?.opciones) ? meal.opciones : []);
  const safeItems = cleanList(items, 6, 140);

  const header =
    `${emojiForMeal(name)} ${bold(name)} — ${kcal} kcal | P ${p}g C ${c}g G ${f}g`;

  const body = safeItems.length
    ? safeItems.map(it => `- ${cleanStr(it, 160)}`).join("\n")
    : "- (sin items)";

  return `${header}\n${body}`;
}

function fmtDayHeader(dayObj) {
  const dia = num(dayObj?.dia);
  const total = dayObj?.total_dia || {};
  const tk = num(total?.kcal);
  const tp = num(total?.proteina_g);
  const tc = num(total?.carbos_g);
  const tf = num(total?.grasas_g);

  return (
    `📅 ${bold(`Plan nutricional — Día ${dia}`)}\n` +
    `🎯 ${bold("Total día")}: ${tk} kcal | P ${tp}g C ${tc}g G ${tf}g\n`
  );
}

// Divide por límites sin cortar líneas a la mitad
function chunkByLines(text, limit = WA_CHUNK_LIMIT) {
  const s = cleanStr(text, WA_HARD_LIMIT * 3); // dejamos margen interno
  const lines = s.split("\n");
  const chunks = [];
  let cur = "";

  for (const line of lines) {
    const add = cur ? `${cur}\n${line}` : line;
    if (add.length <= limit) {
      cur = add;
      continue;
    }
    if (cur) chunks.push(cur);
    // si una línea sola excede limit, la cortamos duro
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

async function sendDayInChunks(api, waId, dayObj) {
  const meals = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];

  // Armamos bloques: header + 1–2 comidas por chunk (más legible)
  const header = fmtDayHeader(dayObj);
  const mealBlocks = meals.map((m, i) => fmtMeal(m, i));

  // Strategy: header va con la primera comida si entra
  const blocks = [header, ...mealBlocks];

  // Vamos acumulando por bloques completos
  let cur = "";
  const chunks = [];

  for (const b of blocks) {
    const candidate = cur ? `${cur}\n\n${b}` : b;
    if (candidate.length <= WA_CHUNK_LIMIT) {
      cur = candidate;
      continue;
    }
    if (cur) chunks.push(cur);
    // si un bloque es enorme (items largos), lo partimos por líneas
    if (b.length > WA_CHUNK_LIMIT) {
      chunks.push(...chunkByLines(b, WA_CHUNK_LIMIT));
      cur = "";
    } else {
      cur = b;
    }
  }
  if (cur) chunks.push(cur);

  // Enviar en orden
  for (const msg of chunks) {
    await sendText(api, waId, cleanStr(msg, WA_HARD_LIMIT));
  }
}

// ======================
// Public: sendPlanDetailed
// ======================
export async function sendPlanDetailed(api, waId, planObj, profile) {
  // 1) Diagnóstico (ya lo mandaste antes en nutritionFlow; acá lo respetamos si querés reutilizar)
  // Si querés mantenerlo acá también, descomentá:
  // const diag = cleanStr(planObj?.diagnostico_breve, 650);
  // if (diag) await sendText(api, waId, `🧠 *Diagnóstico breve:*\n${diag}\n\n_(Nota: macros/calorías son aproximados.)_`);

  // 2) Plan 7 días (en chunks, no 1 mensaje por día)
  const plan = Array.isArray(planObj?.plan_7_dias) ? planObj.plan_7_dias : [];
  if (!plan.length) {
    await sendText(
      api,
      waId,
      "No pude generar el plan completo. Decime tus horarios típicos y preferencias y lo rearmamos."
    );
    return;
  }

  // Asegurar orden 1..7
  const byDay = new Map();
  for (const d of plan) {
    const n = num(d?.dia);
    if (n >= 1 && n <= 7 && !byDay.has(n)) byDay.set(n, d);
  }

  for (let d = 1; d <= 7; d++) {
    const dayObj = byDay.get(d);
    if (!dayObj) continue;
    await sendDayInChunks(api, waId, dayObj);
  }

  // 3) Entrenamiento complementario (si llega)
  const train = cleanList(planObj?.entrenamiento_complementario, 2, 220);
  if (train.length) {
    await sendText(api, waId, `🏋️ ${bold("Entrenamiento complementario")}:\n- ${train[0]}\n- ${train[1]}`);
  }

  // 4) Lista de compras
  const shopping = cleanList(planObj?.lista_compras, 20, 80);
  if (shopping.length) {
    await sendText(api, waId, `🛒 ${bold("Lista de compras (base)")}:\n- ${shopping.join("\n- ")}`);
  }

  // 5) Antropometría / derivación
  const ant = cleanStr(planObj?.sugerir_antropometria ?? "", 320);
  const der = cleanStr(planObj?.derivacion ?? "", 320);

  if (ant) await sendText(api, waId, `📏 ${bold("Antropometría")}:\n${ant}`);
  if (der) await sendText(api, waId, `🩺 ${bold("Derivación sugerida")}:\n${der}`);
}
