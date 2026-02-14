import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ENV_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "";
const GEMINI_IMAGE_MODEL = ENV_IMAGE_MODEL.toLowerCase().includes("preview")
  ? "gemini-2.5-flash-image"
  : (ENV_IMAGE_MODEL || "gemini-2.5-flash-image");

export function initImageStorage() {
  const GENERATED_DIR = path.join(process.cwd(), "generated");
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
  return { GENERATED_DIR };
}

export function buildExerciseImagePrompt(exerciseQuery) {
  return `
Ilustración técnica instructiva del ejercicio: "${exerciseQuery}"

REQUISITOS:
- Fondo blanco puro.
- Estilo ilustración limpia tipo manual.
- Sin texto, sin letras, sin números, sin etiquetas.
- Dos paneles verticales separados por línea fina.
- Misma persona, mismo ángulo, coherente.
- Técnica correcta y segura, alineación articular correcta.
- Evitar errores típicos.

El panel 1 muestra una posición inicial estable.
El panel 2 muestra la posición de mayor recorrido/contracción correcta.

NO TEXTO. NO INGLÉS.
`.trim();
}

async function safeRead(r) {
  try { return await r.json(); } catch { return await r.text(); }
}

export async function generateExerciseImageAndSave(imagePrompt) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }]
    })
  });

  const data = await safeRead(response);

  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `Image gen failed (${response.status})`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p) => p.inlineData?.data);
  const b64 = inline?.inlineData?.data;
  if (!b64) throw new Error("No inline image data returned");

  const buffer = Buffer.from(b64, "base64");
  const filename = `${crypto.randomBytes(12).toString("hex")}.png`;
  const GENERATED_DIR = path.join(process.cwd(), "generated");
  fs.writeFileSync(path.join(GENERATED_DIR, filename), buffer);

  return filename;
}
