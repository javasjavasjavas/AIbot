const EXERCISE_KEYWORDS = [
  "press banca", "press de banca", "press pecho", "press militar",
  "sentadilla", "peso muerto", "dominadas", "remo", "curl",
  "hip thrust", "plancha",
  "vuelos laterales", "elevaciones laterales", "elevacion lateral", "laterales",
  "hombros", "abdominales", "zancadas", "estocadas", "gemelos"
];

export const PLANS_IMAGE_URL = process.env.PLANS_IMAGE_URL || "";
export const CLASSES_IMAGE_URL = process.env.CLASSES_IMAGE_URL || "";

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
  return t.includes("clase") || t.includes("clases") || t.includes("horario") || t.includes("horarios");
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
  return isAskingPrices(text) || isAskingClasses(text) || isExerciseIntent(text) || wantsImage(text);
}
