export function sumMacrosFromMeals(meals = []) {
  const sum = { kcal: 0, proteina_g: 0, carbos_g: 0, grasas_g: 0 };
  for (const m of meals) {
    sum.kcal += Number(m?.kcal ?? 0) || 0;
    sum.proteina_g += Number(m?.proteina_g ?? 0) || 0;
    sum.carbos_g += Number(m?.carbos_g ?? 0) || 0;
    sum.grasas_g += Number(m?.grasas_g ?? 0) || 0;
  }
  sum.kcal = Math.round(sum.kcal);
  sum.proteina_g = Math.round(sum.proteina_g);
  sum.carbos_g = Math.round(sum.carbos_g);
  sum.grasas_g = Math.round(sum.grasas_g);
  return sum;
}

export function hasZeroMacros(obj) {
  const k = Number(obj?.kcal ?? 0) || 0;
  const p = Number(obj?.proteina_g ?? 0) || 0;
  const c = Number(obj?.carbos_g ?? 0) || 0;
  const f = Number(obj?.grasas_g ?? 0) || 0;
  return k <= 0 || p <= 0 || c <= 0 || f <= 0;
}

export function validateDayPlan(dayObj, expectedMeals) {
  if (!dayObj) return { ok: false, reason: "dayObj null" };
  const meals = Array.isArray(dayObj?.comidas) ? dayObj.comidas : [];
  if (meals.length !== expectedMeals) return { ok: false, reason: `comidas length ${meals.length} != ${expectedMeals}` };

  for (const m of meals) {
    if (hasZeroMacros(m)) return { ok: false, reason: "meal macros/kcal en 0 o faltantes" };
  }

  const total = dayObj?.total_dia || {};
  if (hasZeroMacros(total)) {
    dayObj.total_dia = sumMacrosFromMeals(meals);
    if (hasZeroMacros(dayObj.total_dia)) return { ok: false, reason: "total_dia inválido" };
  }

  return { ok: true };
}
