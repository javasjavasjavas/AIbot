// src/nutrition/prompts.js
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
- Actividad física: ${profile.activityPerWeek ?? "N/A"} veces/semana
- % grasa (si existe): ${profile.bodyFatPercent ?? "N/A"}
- Última Antropometría: ${profile.lastAnthro ?? "N/A"}
- Hábitos y contexto (clave): ${profile.analysisNotes ?? "N/A"}

Tarea:
1) "diagnostico_breve" (2-4 líneas) específico al objetivo + hábitos.
2) Definí "targets_diarios" (kcal, proteína, carbos, grasas) coherentes con el perfil
   (edad/sexo/peso/objetivo/actividad física semanal).
3) Elegí "comidas_por_dia" (3 a 6) coherente con objetivo + hábitos + actividad.
4) Definí "prioridades_semana" (4-6 bullets) accionables según hábitos (poca proteína/agua/alcohol/hambre nocturna).

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
- Objetivo: ${goal}
- Peso: ${profile.weightKg ?? "N/A"} kg | Altura: ${profile.heightCm ?? "N/A"} cm | Edad: ${profile.age ?? "N/A"} | Sexo: ${profile.sex ?? "N/A"}
- Actividad física: ${profile.activityPerWeek ?? "N/A"} veces/semana
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
- "nombre"
- "items" con cantidades reales (gramos, ml, unidades) y preparaciones realistas
- macros por comida (kcal, proteína, carbos, grasas) NO pueden ser 0
- "total_dia" debe coincidir (aprox) con la suma de comidas (NO 0)

Reglas de coherencia profesional:
- Desayuno/media mañana: evitar combinaciones raras (pescado/atún) salvo preferencia explícita.
- Pre-entreno: carbos + proteína moderada, baja grasa/fibra.
- Cena: saciedad si hay hambre nocturna.
- Ajustar por objetivo + actividad semanal (más actividad → más energía/carbohidratos, sin bajar proteína).
- Si reporta poca agua: incluir recordatorios (ej: 500 ml en 2-3 momentos).
- Si reporta alcohol: proponer alternativas, no recomendarlo.

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

// ✅ NUEVO: Lista de compras basada en el plan real
export function buildShoppingPrompt(profile, meta, plan7) {
  const goal = profile.objective ? `${profile.objective} (${objectiveLabel(profile.objective)})` : "no definido";

  return `
Sos un nutricionista deportivo profesional. ESPAÑOL. SIN saludos.

Objetivo: ${goal}
Actividad física: ${profile.activityPerWeek ?? "N/A"} veces/semana

Te paso el plan de 7 días en JSON. Necesito una LISTA DE COMPRAS basada SOLO en los ingredientes usados en el plan.
- Consolidar y deduplicar (ej: “pollo” una sola vez).
- Incluir cantidades semanales aproximadas (g/ml/unidades) cuando sea posible.
- Agrupar por categorías: proteinas, carbohidratos, frutas_verduras, lacteos, grasas, varios.
- Máximo 35 ítems.
- No inventes alimentos que no estén en el plan.

PLAN_7_DIAS_JSON:
${JSON.stringify(plan7)}

DEVOLVÉ SOLO JSON VÁLIDO:
{
  "lista_compras": [
    {"categoria":"proteinas","item":"pechuga de pollo","cantidad_aprox":"1.2 kg"},
    {"categoria":"carbohidratos","item":"arroz","cantidad_aprox":"1 kg"},
    {"categoria":"frutas_verduras","item":"bananas","cantidad_aprox":"7 unidades"}
  ]
}
`.trim();
}
