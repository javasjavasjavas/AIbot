function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function hasZeroMacros(obj) {
  const k = num(obj?.kcal);
  const p = num(obj?.proteina_g);
  const c = num(obj?.carbos_g);
  const f = num(obj?.grasas_g);
  return k <= 0 || p <= 0 || c <= 0 || f <= 0;
}

function sumMacros(meals = []) {
  return meals.reduce((acc, m) => ({
    kcal: acc.kcal + num(m?.kcal),
    proteina_g: acc.proteina_g + num(m?.proteina_g),
    carbos_g: acc.carbos_g + num(m?.carbos_g),
    grasas_g: acc.grasas_g + num(m?.grasas_g),
  }), { kcal: 0, proteina_g: 0, carbos_g: 0, grasas_g: 0 });
}

function withinTol(a, b, tol) {
  return Math.abs(num(a) - num(b)) <= tol;
}

export function validateDayPlan(dayObj, expectedMeals) {
  if (!dayObj) return { ok: false, reason: "dayObj null" };

  const meals = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];
  if (meals.length !== expectedMeals) return { ok: false, reason: `comidas ${meals.length} != ${expectedMeals}` };

  for (const m of meals) {
    if (hasZeroMacros(m)) return { ok: false, reason: "meal macros 0" };
  }

  const total = dayObj?.total_dia || {};
  if (hasZeroMacros(total)) return { ok: false, reason: "total_dia macros 0" };

  const sum = sumMacros(meals);
  if (!withinTol(total.kcal, sum.kcal, 150)) return { ok: false, reason: "kcal total no coincide" };
  if (!withinTol(total.proteina_g, sum.proteina_g, 20)) return { ok: false, reason: "P total no coincide" };
  if (!withinTol(total.carbos_g, sum.carbos_g, 30)) return { ok: false, reason: "C total no coincide" };
  if (!withinTol(total.grasas_g, sum.grasas_g, 15)) return { ok: false, reason: "G total no coincide" };

  return { ok: true };
}

export function validateMeta(metaObj) {
  if (!metaObj) return { ok: false, reason: "meta null" };
  const t = metaObj?.targets_diarios || {};
  if (hasZeroMacros(t)) return { ok: false, reason: "targets_diarios inválidos" };
  const meals = num(metaObj?.comidas_por_dia);
  if (meals < 3 || meals > 6) return { ok: false, reason: "comidas_por_dia fuera de rango" };
  const pri = Array.isArray(metaObj?.prioridades_semana) ? metaObj.prioridades_semana : [];
  if (pri.length < 3) return { ok: false, reason: "prioridades insuficientes" };
  return { ok: true };
}
