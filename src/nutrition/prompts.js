import { objectiveLabel } from "./parsers.js";

export function buildMetaPrompt(profile) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";

  return `
Sos un nutricionista deportivo profesional (no médico). Respuesta 100% en ESPAÑOL. SIN saludos.

Ficha del usuario:
- Objetivo principal: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg
- Altura: ${profile.heightCm ?? "N/A"} cm
- Edad: ${profile.age ?? "N/A"}
- Sexo: ${profile.sex ?? "N/A"}
- % grasa (si existe): ${profile.bodyFatPercent ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- Hábitos y contexto (clave): ${profile.analysisNotes ?? "N/A"}

Tarea:
1) "diagnostico_breve" (2-4 líneas) altamente específico al objetivo + hábitos.
2) Definí "targets_diarios" (kcal, proteína, carbos, grasas) coherentes con el perfil (edad/sexo/peso/objetivo).
3) Elegí "comidas_por_dia" (3 a 6) coherente con objetivo + hábitos (ej: masa/rendimiento suele necesitar más).
4) Definí "prioridades_semana" (4-6 bullets) accionables según hábitos (ej: poca proteína/agua/alcohol/hambre nocturna).
5) Lista de compras general (12-20 ítems) coherente con el plan, sin marcas.

Reglas:
- NO genérico tipo “decime horarios”.
- No dietas extremas.
- No diagnósticos médicos.
- Todo debe sonar a nutricionista real.
- Si hay señales de caso complejo (TCA, embarazo, medicación metabólica, etc.), sugerí derivación.
- Recomendar antropometría cada 4-6 semanas; si no tiene, sugerir baseline en 7 días.

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "diagnostico_breve": "string",
  "targets_diarios": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
  "comidas_por_dia": 0,
  "prioridades_semana": ["...", "..."],
  "lista_compras": ["..."],
  "sugerir_antropometria": "string o null",
  "derivacion": "string o null"
}
`.trim();
}

export function buildDayPrompt(profile, meta, day) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";
  const t = meta?.targets_diarios || {};
  const nMeals = meta?.comidas_por_dia || 4;

  return `
Sos un nutricionista deportivo profesional (no médico). Respuesta 100% en ESPAÑOL. SIN saludos.

Ficha del usuario:
- Objetivo principal: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg | Altura: ${profile.heightCm ?? "N/A"} cm | Edad: ${profile.age ?? "N/A"} | Sexo: ${profile.sex ?? "N/A"}
- Hábitos/contexto: ${profile.analysisNotes ?? "N/A"}

Targets del día (aprox):
- kcal: ${t.kcal ?? 0}
- proteína_g: ${t.proteina_g ?? 0}
- carbos_g: ${t.carbos_g ?? 0}
- grasas_g: ${t.grasas_g ?? 0}
- comidas_por_dia: ${nMeals}

Tarea:
Generá el plan del DÍA ${day} con EXACTAMENTE ${nMeals} comidas.
Cada comida debe tener:
- "nombre" (ej: Desayuno / Media mañana / Almuerzo / Merienda pre-entreno / Cena / etc.)
- "items" con cantidades reales (gramos, ml, unidades) y preparaciones realistas
- macros por comida (kcal, proteína, carbos, grasas) NO pueden ser 0
- "total_dia" debe coincidir (aprox) con la suma de comidas (NO 0)

Reglas de coherencia profesional (sin hardcodear alimentos):
- Desayuno / media mañana: evitar combinaciones raras (ej: pescado/atún) salvo que el usuario lo indique.
- Pre-entreno: incluir carbos + proteína moderada y baja grasa/fibra excesiva.
- Cena: priorizar saciedad si reporta hambre nocturna.
- Ajustar por objetivo: masa/rendimiento tiende a más carbos; pérdida de grasa cuida densidad calórica sin bajar proteína.
- Incluir hidratación sugerida distribuida (si reporta poca agua).
- Evitar alcohol como “recomendación”; si reporta consumo, proponer alternativa.
- Estilo Argentina/LatAm razonable (comidas “normales”), sin recetas exóticas.

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "dia": ${day},
  "total_dia": {"kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0},
  "comidas": [
    {
      "nombre": "string",
      "items": ["item + cantidad", "item + cantidad", "item + cantidad"],
      "kcal": 0, "proteina_g": 0, "carbos_g": 0, "grasas_g": 0
    }
  ]
}
`.trim();
}
