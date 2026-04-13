// Logical component: dyno reclass scaled power and points-above-base (shared by UI + scoring).

import type { RuleAnswer } from '$types/rules';

export type DrivetrainDynoKey = '2wd' | 'awd' | string;

function finiteNumberFromAnswer(value: RuleAnswer | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Loss fraction: 2WD 13%, AWD 16%. */
export function dynoLossFraction(drivetrain: DrivetrainDynoKey | null | undefined): number | null {
  if (drivetrain === '2wd') return 0.13;
  if (drivetrain === 'awd') return 0.16;
  return null;
}

export function computeScaledPowerWheelHp(
  peakHp: number | null,
  peakTorqueLbFt: number | null,
  lossFraction: number | null
): number | null {
  if (
    peakHp === null ||
    peakTorqueLbFt === null ||
    lossFraction === null ||
    !Number.isFinite(peakHp) ||
    !Number.isFinite(peakTorqueLbFt) ||
    lossFraction >= 1
  ) {
    return null;
  }
  const inv = 1 / (1 - lossFraction);
  return peakHp * (2 / 3) * inv + peakTorqueLbFt * (1 / 3) * inv;
}

/** Excel `Car_Scaled_Power`: showroom scaled column 112 − 4.25×(weight ÷ factory power blend). */
export function showroomCarScaledPowerFromCatalog(
  showroomBaseWeightLbs: number,
  factoryRatedHp: number,
  factoryRatedTorqueLbFt: number
): number | null {
  const factoryBlend = factoryRatedHp * (2 / 3) + factoryRatedTorqueLbFt * (1 / 3);
  if (!Number.isFinite(factoryBlend) || factoryBlend <= 0) return null;
  return 112 - 4.25 * (showroomBaseWeightLbs / factoryBlend);
}

/**
 * Excel: IF(ISNUMBER(A71), ((Car_Base_Weight/A71)*-4.25+112)-Car_Scaled_Power, "") with A71 = dyno scaled power,
 * Car_Scaled_Power = showroom 112−4.25×(W÷factory blend). Result clamped to ≥ −2.
 */
export function computeDynoPointsAboveBaseAssessment(input: {
  showroomBaseWeightLbs: number | null;
  scaledPower: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
}): number | null {
  const w = input.showroomBaseWeightLbs;
  const sp = input.scaledPower;
  const hp = input.factoryRatedHp;
  const tq = input.factoryRatedTorqueLbFt;
  if (
    w === null ||
    sp === null ||
    hp === null ||
    tq === null ||
    !Number.isFinite(w) ||
    !Number.isFinite(sp) ||
    sp === 0 ||
    !Number.isFinite(hp) ||
    !Number.isFinite(tq)
  ) {
    return null;
  }
  const carScaledPower = showroomCarScaledPowerFromCatalog(w, hp, tq);
  if (carScaledPower === null || !Number.isFinite(carScaledPower)) return null;
  const raw = (w / sp) * -4.25 + 112 - carScaledPower;
  return Math.max(-2, raw);
}

/** Scaled wheel HP equivalent from session dyno measurement fields. */
export function scaledPowerFromDynoAnswers(answers: Record<string, RuleAnswer>): number | null {
  const hp = finiteNumberFromAnswer(answers.dyno_peak_horsepower ?? null);
  const tq = finiteNumberFromAnswer(answers.dyno_peak_torque_lbft ?? null);
  const d = answers.dyno_drivetrain_type;
  const loss = dynoLossFraction(typeof d === 'string' ? d : null);
  return computeScaledPowerWheelHp(hp, tq, loss);
}

export function dynoPointsAboveBaseFromSession(input: {
  answers: Record<string, RuleAnswer>;
  showroomBaseWeightLbs: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
}): number | null {
  const scaled = scaledPowerFromDynoAnswers(input.answers);
  return computeDynoPointsAboveBaseAssessment({
    showroomBaseWeightLbs: input.showroomBaseWeightLbs,
    scaledPower: scaled,
    factoryRatedHp: input.factoryRatedHp,
    factoryRatedTorqueLbFt: input.factoryRatedTorqueLbFt
  });
}

/** Workbook-style breakdown for UI: same math as {@link computeDynoPointsAboveBaseAssessment}. */
export type DynoPointsAboveBaseExplanation = {
  result: number;
  raw: number;
  scaledPower: number;
  showroomWeightLbs: number;
  factoryRatedHp: number;
  factoryRatedTorqueLbFt: number;
  factoryBlend: number;
  /** Excel Car_Scaled_Power (showroom scaled W/P column). */
  carScaledPower: number;
  /** True when raw is below −2 so the published result is the −2 floor. */
  clampedToMinusTwo: boolean;
};

export function explainDynoPointsAboveBaseFromSession(input: {
  answers: Record<string, RuleAnswer>;
  showroomBaseWeightLbs: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
}): DynoPointsAboveBaseExplanation | null {
  const scaled = scaledPowerFromDynoAnswers(input.answers);
  const w = input.showroomBaseWeightLbs;
  const hp = input.factoryRatedHp;
  const tq = input.factoryRatedTorqueLbFt;
  if (
    w === null ||
    scaled === null ||
    hp === null ||
    tq === null ||
    !Number.isFinite(w) ||
    !Number.isFinite(scaled) ||
    scaled === 0 ||
    !Number.isFinite(hp) ||
    !Number.isFinite(tq)
  ) {
    return null;
  }
  const factoryBlend = hp * (2 / 3) + tq * (1 / 3);
  const carScaledPower = showroomCarScaledPowerFromCatalog(w, hp, tq);
  if (carScaledPower === null || !Number.isFinite(carScaledPower)) {
    return null;
  }
  const raw = (w / scaled) * -4.25 + 112 - carScaledPower;
  const result = Math.max(-2, raw);
  return {
    result,
    raw,
    scaledPower: scaled,
    showroomWeightLbs: w,
    factoryRatedHp: hp,
    factoryRatedTorqueLbFt: tq,
    factoryBlend,
    carScaledPower,
    clampedToMinusTwo: raw < -2
  };
}

/** Symbolic equation (matches {@link computeDynoPointsAboveBaseAssessment} / Excel). */
export const DYNO_POINTS_ABOVE_BASE_SYMBOLIC =
  'max(−2, ((W ÷ SP) × (−4.25) + 112) − CSP)  with  W = Car_Base_Weight (lbs),  SP = scaled dyno power (A71),  CSP = Car_Scaled_Power = 112 − 4.25×(W÷FB),  FB = (⅔)×catalog HP + (⅓)×catalog torque.';

export function formatDynoPointsAboveBaseExplanation(ex: DynoPointsAboveBaseExplanation): string {
  const sp = ex.scaledPower.toFixed(4);
  const fb = ex.factoryBlend.toFixed(4);
  const csp = ex.carScaledPower.toFixed(4);
  const rawStr = ex.raw.toFixed(4);
  const lines = [
    DYNO_POINTS_ABOVE_BASE_SYMBOLIC,
    '',
    'Substituted:',
    `  SP = ${sp}   (from peak wheel HP / torque and drivetrain loss)`,
    `  FB = ${fb}   (= (⅔)×${ex.factoryRatedHp} + (⅓)×${ex.factoryRatedTorqueLbFt})`,
    `  CSP = 112 − 4.25×(${ex.showroomWeightLbs} ÷ ${fb}) = ${csp}`,
    `  raw = ((${ex.showroomWeightLbs} ÷ ${sp}) × (−4.25) + 112) − ${csp} = ${rawStr}`,
    `  result = max(−2, ${rawStr}) = ${ex.result.toFixed(2)}`
  ];
  if (ex.clampedToMinusTwo) {
    lines.push('', 'Raw is below −2, so the workbook floor of −2 pts applies.');
  }
  return lines.join('\n');
}
