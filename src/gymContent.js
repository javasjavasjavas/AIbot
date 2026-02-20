const EXERCISE_KEYWORDS = [
  "press banca", "press de banca", "press pecho", "press militar",
  "sentadilla", "peso muerto", "dominadas", "remo", "curl",
  "hip thrust", "plancha",
  "vuelos laterales", "elevaciones laterales", "elevacion lateral", "laterales",
  "hombros", "abdominales", "zancadas", "estocadas", "gemelos"
];

export const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
export const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";
export const GYM_TIMEZONE = process.env.GYM_TIMEZONE || "America/Argentina/Buenos_Aires";

const DEFAULT_GYM_HOURS = {
  mon: [{ open: "06:00", close: "23:00" }],
  tue: [{ open: "06:00", close: "23:00" }],
  wed: [{ open: "06:00", close: "23:00" }],
  thu: [{ open: "06:00", close: "23:00" }],
  fri: [{ open: "06:00", close: "23:00" }],
  sat: [{ open: "08:00", close: "20:00" }],
  sun: [{ open: "09:00", close: "14:00" }]
};

function parseGymHours() {
  const raw = process.env.GYM_HOURS_JSON || "";
  if (!raw.trim()) return DEFAULT_GYM_HOURS;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : DEFAULT_GYM_HOURS;
  } catch {
    return DEFAULT_GYM_HOURS;
  }
}

const GYM_HOURS = parseGymHours();
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miercoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sabado",
  sun: "Domingo"
};

function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function isAskingPrices(text) {
  const t = normalizeText(text);
  return (
    t.includes("precio") ||
    t.includes("precios") ||
    t.includes("planes") ||
    t.includes("membresia") ||
    t.includes("membresía") ||
    t.includes("cuanto cuesta") ||
    t.includes("cuánto cuesta") ||
    t.includes("cuanto sale") ||
    t.includes("valor")
  );
}

export function formatPlansText() {
  return (
    "Planes disponibles:\n\n" +
    "Plan Black — $42.990/mes\n" +
    "- 12 meses de fidelidad\n- Inscripción gratis\n- Peso libre + cardio + clases\n- Acceso LatAm\n- App\n- 5 pases/mes\n- Sillones de masaje\n\n" +
    "Plan Fit — $34.990/mes\n" +
    "- 12 meses de fidelidad\n- Inscripción gratis\n- Peso libre + cardio + clases\n- App\n\n" +
    "Plan Smart — $39.990/mes\n" +
    "- Sin fidelidad\n- Inscripción gratis\n- Peso libre + cardio + clases\n- App\n- Sin permanencia mínima\n"
  );
}

export function isAskingClasses(text) {
  const t = normalizeText(text);
  return t.includes("clase") || t.includes("clases");
}

export function isAskingGymHours(text) {
  const t = normalizeText(text);
  return (
    t.includes("horario") ||
    t.includes("horarios") ||
    t.includes("abierto") ||
    t.includes("abierta") ||
    t.includes("abre") ||
    t.includes("abren") ||
    t.includes("apertura") ||
    t.includes("cierre") ||
    t.includes("cierran")
  );
}

function parseMinutes(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function nowInTimezoneParts(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date());

  const obj = {};
  for (const p of parts) obj[p.type] = p.value;
  const wk = String(obj.weekday || "").toLowerCase();
  const dayMap = { mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun" };
  return {
    dayKey: dayMap[wk] || "mon",
    nowMinutes: parseMinutes(`${obj.hour || "00"}:${obj.minute || "00"}`) || 0
  };
}

function isOpenNow(scheduleByDay, timeZone) {
  const { dayKey, nowMinutes } = nowInTimezoneParts(timeZone);
  const slots = Array.isArray(scheduleByDay?.[dayKey]) ? scheduleByDay[dayKey] : [];
  for (const slot of slots) {
    const open = parseMinutes(slot?.open);
    const close = parseMinutes(slot?.close);
    if (open === null || close === null) continue;
    if (nowMinutes >= open && nowMinutes < close) {
      return { open: true, dayKey, slot };
    }
  }
  return { open: false, dayKey, slot: null };
}

function formatDaySlots(slots) {
  if (!Array.isArray(slots) || !slots.length) return "Cerrado";
  return slots
    .map((slot) => `${slot?.open || "--:--"} a ${slot?.close || "--:--"}`)
    .join(" / ");
}

export function formatGymHoursGridText() {
  const lines = [
    `- Lunes: ${formatDaySlots(GYM_HOURS.mon)}`,
    `- Martes: ${formatDaySlots(GYM_HOURS.tue)}`,
    `- Miercoles: ${formatDaySlots(GYM_HOURS.wed)}`,
    `- Jueves: ${formatDaySlots(GYM_HOURS.thu)}`,
    `- Viernes: ${formatDaySlots(GYM_HOURS.fri)}`,
    `- Sabado: ${formatDaySlots(GYM_HOURS.sat)}`,
    `- Domingo: ${formatDaySlots(GYM_HOURS.sun)}`
  ];

  return (
    "Horarios del gimnasio:\n\n" +
    `${lines.join("\n")}\n\n` +
    `Zona horaria: ${GYM_TIMEZONE}`
  );
}

function getTodaySlots(dayKey) {
  const slots = Array.isArray(GYM_HOURS?.[dayKey]) ? GYM_HOURS[dayKey] : [];
  return slots
    .map((slot) => ({ open: slot?.open || "", close: slot?.close || "" }))
    .filter((slot) => parseMinutes(slot.open) !== null && parseMinutes(slot.close) !== null);
}

function getNextOpening(dayKey, nowMinutes) {
  const todaySlots = getTodaySlots(dayKey);
  for (const slot of todaySlots) {
    const open = parseMinutes(slot.open);
    if (open !== null && open > nowMinutes) {
      return { dayKey, open: slot.open };
    }
  }

  const startIndex = DAY_ORDER.indexOf(dayKey);
  for (let i = 1; i <= 7; i++) {
    const idx = (startIndex + i) % DAY_ORDER.length;
    const key = DAY_ORDER[idx];
    const slots = getTodaySlots(key);
    if (slots.length) return { dayKey: key, open: slots[0].open };
  }
  return null;
}

export function getGymHoursContext() {
  const now = nowInTimezoneParts(GYM_TIMEZONE);
  const status = isOpenNow(GYM_HOURS, GYM_TIMEZONE);
  const todaySlots = getTodaySlots(now.dayKey);
  const next = getNextOpening(now.dayKey, now.nowMinutes);

  return {
    timeZone: GYM_TIMEZONE,
    dayKey: now.dayKey,
    dayLabel: DAY_LABELS[now.dayKey] || now.dayKey,
    isOpenNow: status.open,
    currentSlot: status.slot || null,
    todaySlots,
    nextOpening: next
  };
}

export function formatGymHoursAnswer(queryType = "full_grid") {
  const ctx = getGymHoursContext();

  if (queryType === "open_now") {
    if (ctx.isOpenNow) {
      return `Si, ahora esta abierto. Hoy cierra a las ${ctx.currentSlot?.close || "--:--"} (${ctx.timeZone}).`;
    }
    if (ctx.nextOpening?.dayKey === ctx.dayKey) {
      return `Ahora esta cerrado. Hoy vuelve a abrir a las ${ctx.nextOpening.open} (${ctx.timeZone}).`;
    }
    if (ctx.nextOpening) {
      return `Ahora esta cerrado. Vuelve a abrir el ${DAY_LABELS[ctx.nextOpening.dayKey]} a las ${ctx.nextOpening.open} (${ctx.timeZone}).`;
    }
    return `Ahora esta cerrado. No hay aperturas configuradas en la grilla (${ctx.timeZone}).`;
  }

  if (queryType === "open_today") {
    if (ctx.todaySlots.length) {
      return `Si, hoy (${ctx.dayLabel}) esta abierto en: ${formatDaySlots(ctx.todaySlots)} (${ctx.timeZone}).`;
    }
    return `No, hoy (${ctx.dayLabel}) esta cerrado (${ctx.timeZone}).`;
  }

  if (queryType === "close_today") {
    if (!ctx.todaySlots.length) {
      return `Hoy (${ctx.dayLabel}) esta cerrado, no hay horario de cierre (${ctx.timeZone}).`;
    }
    const last = ctx.todaySlots[ctx.todaySlots.length - 1];
    return `Hoy (${ctx.dayLabel}) cierra a las ${last.close} (${ctx.timeZone}).`;
  }

  return formatGymHoursGridText();
}

export function formatGymHoursText() {
  const status = formatGymHoursAnswer("open_now");
  return `${formatGymHoursGridText()}\n\nEstado actual: ${status.replace(/\.$/, "")}.`;
}

export function wantsImage(text) {
  const t = normalizeText(text);
  return t.includes("imagen") || t.includes("foto") || t.includes("descriptiva") || t.includes("grafico") || t.includes("gráfico");
}

export function isExerciseIntent(text) {
  const t = normalizeText(text);
  if (EXERCISE_KEYWORDS.some(k => t.includes(normalizeText(k)))) return true;

  const howTo = t.includes("como") || t.includes("cómo");
  const doIt = t.includes("hacer") || t.includes("se hace") || t.includes("realizar");
  const bodyParts = ["hombro", "pecho", "espalda", "pierna", "biceps", "bíceps", "triceps", "tríceps", "gluteo", "glúteo", "abdomen", "core"];
  const mentionsBody = bodyParts.some(b => t.includes(normalizeText(b)));

  if ((howTo && doIt) && mentionsBody) return true;
  return false;
}

export function isGymIntent(text) {
  return isAskingPrices(text) || isAskingClasses(text) || isAskingGymHours(text) || isExerciseIntent(text) || wantsImage(text);
}
