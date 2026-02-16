import { sendText } from "../whatsapp.js";
import { cleanStr, cleanList } from "./sanitize.js";
import { fmtDay, splitDayMessageByMeals } from "./formatters.js";

export async function sendPlanDetailed(api, waId, planObj, profile) {
  const plan = Array.isArray(planObj?.plan_7_dias) ? planObj.plan_7_dias : [];

  // 7 días
  const byDay = new Map();
  for (const d of plan) {
    const n = Number(d?.dia ?? 0) || 0;
    if (n >= 1 && n <= 7 && !byDay.has(n)) byDay.set(n, d);
  }

  for (let d = 1; d <= 7; d++) {
    const dayObj = byDay.get(d);
    if (!dayObj) continue;

    const { header, blocks } = fmtDay(dayObj);
    const msgs = splitDayMessageByMeals(header, blocks, 1450);

    if (msgs.length === 1) {
      await sendText(api, waId, cleanStr(msgs[0], 1450));
    } else {
      await sendText(api, waId, cleanStr(`${msgs[0]}\n\n_(continúa)_`, 1450));
      await sendText(api, waId, cleanStr(`📌 *Día ${d} (parte 2)*\n\n${msgs[1]}`, 1450));
    }
  }

  // entrenamiento complementario (fallback simple)
  // (si querés, lo movemos también a un módulo aparte)
  const obj = profile.objective;
  let trainOut;
  if (obj === "A") trainOut = [
    "3-5 sesiones/semana. Sumá 2-3 caminatas de 20-30 min.",
    "Priorizá sueño (7h+) y adherencia."
  ];
  else if (obj === "B") trainOut = [
    "4-5 sesiones/semana. Progresá y recuperá (comer + dormir).",
    "Post-entreno: proteína + carbos dentro de 1-2 horas."
  ];
  else if (obj === "D") trainOut = [
    "4-6 sesiones/semana. Carbos pre-entreno e hidratación consistente.",
    "Si estás muy fatigado, bajá intensidad pero mantené constancia."
  ];
  else trainOut = [
    "3+ sesiones/semana como base y consistencia.",
    "Dormir e hidratarte bien mejora resultados con el tiempo."
  ];

  await sendText(api, waId, `🏋️ *Entrenamiento complementario:*\n- ${trainOut[0]}\n- ${trainOut[1]}`);

  // lista de compras
  const shopping = cleanList(planObj?.lista_compras, 20, 60);
  if (shopping.length) {
    await sendText(api, waId, `🛒 *Lista de compras (base):*\n- ${shopping.join("\n- ")}`);
  }

  const ant = cleanStr(planObj?.sugerir_antropometria ?? "", 260);
  const der = cleanStr(planObj?.derivacion ?? "", 260);
  if (ant) await sendText(api, waId, `📏 *Antropometría:*\n${ant}`);
  if (der) await sendText(api, waId, `🩺 *Derivación sugerida:*\n${der}`);
}
