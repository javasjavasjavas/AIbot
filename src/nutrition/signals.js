import { normalizeText, objectiveLabel } from "./parsers.js";

export function inferSignalsFromNotes(notesRaw) {
  const t = normalizeText(notesRaw || "");
  return {
    lowProtein: t.includes("poca prote") || t.includes("baja prote") || t.includes("casi no prote"),
    lowWater: t.includes("poca agua") || t.includes("tomo poca") || t.includes("casi no tomo"),
    highAlcohol: t.includes("alcohol") && (t.includes("3") || t.includes("mas") || t.includes("más") || t.includes("seguido")),
    nightHunger: t.includes("hambre de noche") || t.includes("picoteo nocturno") || t.includes("pico de noche"),
    lowEnergy: t.includes("sin energia") || t.includes("sin energía") || t.includes("llego cansado") || t.includes("me falta energia")
  };
}

export function buildDeterministicDiagnosis(profile) {
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

export function recommendedMealsPerDay(profile) {
  const obj = profile.objective;
  const s = inferSignalsFromNotes(profile.analysisNotes);

  let n;
  if (obj === "A") n = 3;
  else if (obj === "B") n = 5;
  else if (obj === "C") n = 4;
  else if (obj === "D") n = 5;
  else n = 3;

  if (s.nightHunger) n = Math.max(n, 4);
  if (s.lowEnergy && (obj === "D" || obj === "B")) n = Math.max(n, 5);
  if ((profile.age ?? 0) >= 40) n = Math.max(n, 4);

  if (n < 3) n = 3;
  if (n > 6) n = 6;
  return n;
}
