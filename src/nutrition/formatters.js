import { cleanStr } from "./sanitize.js";
import { normalizeText } from "./parsers.js";

function mealEmoji(name = "") {
  const t = normalizeText(name);
  if (t.includes("desay")) return "🍳";
  if (t.includes("almuer")) return "🍗";
  if (t.includes("cena")) return "🍽️";
  if (t.includes("merien")) return "☕";
  if (t.includes("media")) return "🥛";
  if (t.includes("pre")) return "⚡";
  if (t.includes("post")) return "💪";
  if (t.includes("snack")) return "🍎";
  return "🥗";
}

export function fmtMeal(meal) {
  const name = cleanStr(meal?.nombre, 40) || "Comida";
  const items = Array.isArray(meal?.items) ? meal.items.map(i => cleanStr(i, 80)).filter(Boolean) : [];
  const kcal = Number(meal?.kcal ?? 0) || 0;
  const p = Number(meal?.proteina_g ?? 0) || 0;
  const c = Number(meal?.carbos_g ?? 0) || 0;
  const f = Number(meal?.grasas_g ?? 0) || 0;

  const icon = mealEmoji(name);
  const itemsLine = items.length ? items.slice(0, 5).join(" / ") : "(sin detalle)";
  return `*${icon} ${name}* — ${kcal} kcal | *P* ${p}g  *C* ${c}g  *G* ${f}g\n${itemsLine}`;
}

export function splitDayMessageByMeals(header, mealBlocks, maxLen = 1450) {
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

export function fmtDay(dayObj) {
  const dia = Number(dayObj?.dia ?? 0) || 0;
  const total = dayObj?.total_dia || {};
  const tk = Number(total?.kcal ?? 0) || 0;
  const tp = Number(total?.proteina_g ?? 0) || 0;
  const tc = Number(total?.carbos_g ?? 0) || 0;
  const tf = Number(total?.grasas_g ?? 0) || 0;

  const comidas = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];
  const blocks = comidas.slice(0, 8).map(fmtMeal);

  const header =
    `📅 *Plan nutricional — Día ${dia}*\n` +
    `🎯 *Total día:* ${tk} kcal | *P* ${tp}g  *C* ${tc}g  *G* ${tf}g`;

  return { header, blocks };
}
