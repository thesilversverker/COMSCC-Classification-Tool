// Logical component: COMSCC showroom math from scalar inputs (workbook-style); JSON template supplies inputs only.

/**
 * @param {Record<string, unknown>} scalars - showroomBaseWeightLbs, factoryRatedHp, factoryRatedTorqueLbFt, suspIndex
 * @returns {Record<string, number | null>} derived fields; null when inputs insufficient
 */
export function computeComsccDerivedFields(scalars) {
  const w = num(scalars.showroomBaseWeightLbs);
  const hp = num(scalars.factoryRatedHp);
  const tq = num(scalars.factoryRatedTorqueLbFt);
  const susp = num(scalars.suspIndex);

  if (w === null || hp === null || tq === null) {
    return {
      powerBlend: null,
      weightPerPower: null,
      scaledWeightPerPower: null,
      performanceAdjustment: null,
      showroomAssessment: null
    };
  }

  // Logical component: power blend (2/3 HP + 1/3 torque) per COMSCC-style weight/power table.
  const powerBlend = (2 / 3) * hp + (1 / 3) * tq;
  if (!Number.isFinite(powerBlend) || powerBlend === 0) {
    return {
      powerBlend: null,
      weightPerPower: null,
      scaledWeightPerPower: null,
      performanceAdjustment: susp === null ? null : performanceAdjFromSusp(susp),
      showroomAssessment: null
    };
  }

  const weightPerPower = w / powerBlend;
  // Logical component: scaled column matches workbook rows (e.g. Integra): 112 - 4.25 * weightPerPower.
  const scaledWeightPerPower = 112 - 4.25 * weightPerPower;

  const performanceAdjustment = susp === null ? null : performanceAdjFromSusp(susp);

  const showroomAssessment =
    performanceAdjustment === null || !Number.isFinite(scaledWeightPerPower)
      ? null
      : scaledWeightPerPower + performanceAdjustment;

  return {
    powerBlend,
    weightPerPower,
    scaledWeightPerPower: Number.isFinite(scaledWeightPerPower) ? scaledWeightPerPower : null,
    performanceAdjustment,
    showroomAssessment:
      typeof showroomAssessment === 'number' && Number.isFinite(showroomAssessment)
        ? showroomAssessment
        : null
  };
}

function performanceAdjFromSusp(suspIndex) {
  // Logical component: ((suspIndex - 70) / 3) * 1.5 — template placeholder; workbook rows may differ.
  return ((suspIndex - 70) / 3) * 1.5;
}

function num(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}
