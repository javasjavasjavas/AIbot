import { objectiveLabel } from "./parsers.js";

export function buildMetaPrompt(profile) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";
  return `
Sos un nutricionista deportivo (no médico). Respuesta 100% en ESPAÑOL. SIN saludos.

Contexto:
- Objetivo: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- % grasa: ${profile.bodyFatPercent ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- Hábitos reportados: ${profile.analysisNotes ?? "N/A"}

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "diagnostico_breve": "string (2-3 líneas)",
  "targets_diarios": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
  "comidas_por_dia": 0,
  "prioridades_semana": ["...", "..."],
  "lista_compras": ["..."],
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}

Reglas:
- Nada genérico tipo “decime horarios”.
- Números aproximados pero coherentes.
- Recomendar Antropometría cada 4-6 semanas (si no tiene, sugerí en 7 días baseline).
`.trim();
}

export function buildDayPrompt(profile, meta, day) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";
  const t = meta?.targets_diarios || {};
  const nMeals = meta?.comidas_por_dia || 4;

  return `
Sos un nutricionista deportivo (no médico). Respuesta 100% en ESPAÑOL. SIN saludos.

Usuario:
- Objetivo: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg, Altura: ${profile.heightCm ?? "N/A"} cm, Edad: ${profile.age ?? "N/A"}, Sexo: ${profile.sex ?? "N/A"}
- Hábitos: ${profile.analysisNotes ?? "N/A"}

Targets del día (aprox):
- kcal: ${t.kcal ?? 0}
- proteína_g: ${t.proteina_g ?? 0}
- carbos_g: ${t.carbos_g ?? 0}
- grasas_g: ${t.grasas_g ?? 0}
- comidas_por_dia: ${nMeals}

Tarea:
Generá el DÍA ${day} con EXACTAMENTE ${nMeals} comidas.

PROHIBIDO devolver 0 en macros/kcal. Si no estás seguro, estimá.
El total_dia debe ser suma aproximada de comidas.

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "dia": ${day},
  "total_dia": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
  "comidas": [
    {
      "nombre": "string",
      "items": ["item + cantidad", "item + cantidad"],
      "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0
    }
  ]
}
`.trim();
}
