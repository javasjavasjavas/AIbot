import { getPlanJson } from "./nutrition/geminiClient.js";

function normalizeDomain(v) {
  const x = String(v || "").toLowerCase().trim();
  return x === "gym" || x === "nutrition" || x === "other" ? x : "other";
}

function normalizeGymIntent(v) {
  const x = String(v || "").toLowerCase().trim();
  const valid = new Set(["prices", "classes", "hours", "exercise", "none"]);
  return valid.has(x) ? x : "none";
}

export async function inferIntentWithAI(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return null;

  const prompt =
    "Clasifica la intencion del siguiente mensaje de WhatsApp para un bot de gimnasio/nutricion.\n" +
    "Devuelve SOLO JSON valido con este esquema exacto:\n" +
    "{ \"domain\": \"gym|nutrition|other\", \"gym_intent\": \"prices|classes|hours|exercise|none\", \"confidence\": 0 }\n" +
    "Reglas:\n" +
    "- Si pregunta si esta abierto ahora / a que hora abre o cierra => gym_intent=hours\n" +
    "- Si habla de clases => gym_intent=classes\n" +
    "- Si habla de planes o precios => gym_intent=prices\n" +
    "- Si pregunta como hacer un ejercicio => gym_intent=exercise\n" +
    "- Si es nutricion => domain=nutrition y gym_intent=none\n" +
    "- Si no aplica => domain=other y gym_intent=none\n" +
    "- confidence es un numero entre 0 y 1.\n\n" +
    `Mensaje: """${cleaned}"""`;

  try {
    const out = await getPlanJson(prompt, {
      requireKeys: ["domain", "gym_intent", "confidence"],
      attempts: 1
    });

    const confidenceNum = Number(out?.confidence);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0;

    return {
      domain: normalizeDomain(out?.domain),
      gymIntent: normalizeGymIntent(out?.gym_intent),
      confidence
    };
  } catch {
    return null;
  }
}
