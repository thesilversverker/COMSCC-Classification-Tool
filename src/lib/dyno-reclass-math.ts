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
 * Dyno reclass engine points: same structure as the weight worksheet — dyno-based scaled W/P column
 * plus performance adjustment minus showroom assessment, then hundredths truncated toward −∞ (Excel INT),
 * then **only** if that value is below −2, pin to −2. When catalog has no showroom assessment, falls back
 * to subtracting Car_Scaled_Power (112−4.25×W÷factory blend) only, matching the legacy single-line formula.
 */
export function computeDynoPointsAboveBaseAssessment(input: {
  showroomBaseWeightLbs: number | null;
  scaledPower: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
  performanceAdjustment?: number | null;
  showroomAssessment?: number | null;
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
  // Logical component: scaled column using dyno scaled power (A71), same as (W÷SP)×(−4.25)+112.
  const dynoScaledColumn = 112 - 4.25 * (w / sp);
  if (!Number.isFinite(dynoScaledColumn)) return null;

  const pa =
    typeof input.performanceAdjustment === 'number' && Number.isFinite(input.performanceAdjustment)
      ? input.performanceAdjustment
      : 0;

  const carScaledPower = showroomCarScaledPowerFromCatalog(w, hp, tq);
  if (carScaledPower === null || !Number.isFinite(carScaledPower)) return null;

  const bracket =
    typeof input.showroomAssessment === 'number' && Number.isFinite(input.showroomAssessment)
      ? dynoScaledColumn + pa - input.showroomAssessment
      : dynoScaledColumn - carScaledPower;

  if (!Number.isFinite(bracket)) return null;
  const truncated = Math.floor(bracket * 100) / 100;
  return truncated < -2 ? -2 : truncated;
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
  performanceAdjustment?: number | null;
  showroomAssessment?: number | null;
}): number | null {
  const scaled = scaledPowerFromDynoAnswers(input.answers);
  return computeDynoPointsAboveBaseAssessment({
    showroomBaseWeightLbs: input.showroomBaseWeightLbs,
    scaledPower: scaled,
    factoryRatedHp: input.factoryRatedHp,
    factoryRatedTorqueLbFt: input.factoryRatedTorqueLbFt,
    performanceAdjustment: input.performanceAdjustment,
    showroomAssessment: input.showroomAssessment
  });
}

/** Workbook-style breakdown for UI: same math as {@link computeDynoPointsAboveBaseAssessment}. */
export type DynoPointsAboveBaseExplanation = {
  result: number;
  /** Bracket before INT (dyno scaled column ± showroom path). */
  bracket: number;
  /** After INT(bracket×100)/100 (same convention as weight worksheet). */
  truncatedBracket: number;
  scaledPower: number;
  showroomWeightLbs: number;
  factoryRatedHp: number;
  factoryRatedTorqueLbFt: number;
  factoryBlend: number;
  /** Car_Scaled_Power = 112−4.25×(W÷factory blend); used for fallback when no showroom assessment. */
  carScaledPower: number;
  dynoScaledColumn: number;
  performanceAdjustment: number;
  showroomAssessment: number | null;
  /** True when truncated value is below −2 so the workbook floor of −2 pts applies. */
  clampedToMinusTwo: boolean;
  /** When true, bracket used dynoScaledColumn − CSP (no catalog showroom row). */
  usedCarScaledPowerFallback: boolean;
};

export function explainDynoPointsAboveBaseFromSession(input: {
  answers: Record<string, RuleAnswer>;
  showroomBaseWeightLbs: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
  performanceAdjustment?: number | null;
  showroomAssessment?: number | null;
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
  const dynoScaledColumn = 112 - 4.25 * (w / scaled);
  if (!Number.isFinite(dynoScaledColumn)) return null;

  const pa =
    typeof input.performanceAdjustment === 'number' && Number.isFinite(input.performanceAdjustment)
      ? input.performanceAdjustment
      : 0;

  const sa =
    typeof input.showroomAssessment === 'number' && Number.isFinite(input.showroomAssessment)
      ? input.showroomAssessment
      : null;

  const usedCarScaledPowerFallback = sa === null;
  const bracket = usedCarScaledPowerFallback ? dynoScaledColumn - carScaledPower : dynoScaledColumn + pa - sa;
  if (!Number.isFinite(bracket)) return null;
  const truncatedBracket = Math.floor(bracket * 100) / 100;
  const result = truncatedBracket < -2 ? -2 : truncatedBracket;
  return {
    result,
    bracket,
    truncatedBracket,
    scaledPower: scaled,
    showroomWeightLbs: w,
    factoryRatedHp: hp,
    factoryRatedTorqueLbFt: tq,
    factoryBlend,
    carScaledPower,
    dynoScaledColumn,
    performanceAdjustment: pa,
    showroomAssessment: sa,
    clampedToMinusTwo: truncatedBracket < -2,
    usedCarScaledPowerFallback
  };
}

/** Symbolic equation (matches {@link computeDynoPointsAboveBaseAssessment}). */
export const DYNO_POINTS_ABOVE_BASE_SYMBOLIC =
  'INT((DSC + PA − SA) × 100) / 100, then if that value < −2 use −2; else use that value.  DSC = 112 − 4.25×(W÷SP) with SP = dyno scaled power;  PA = catalog performance adjustment;  SA = catalog showroom assessment. If SA is missing, use DSC − CSP with CSP = 112 − 4.25×(W÷FB), FB = (⅔)×HP + (⅓)×torque.';

export function formatDynoPointsAboveBaseExplanation(ex: DynoPointsAboveBaseExplanation): string {
  const sp = ex.scaledPower.toFixed(4);
  const fb = ex.factoryBlend.toFixed(4);
  const csp = ex.carScaledPower.toFixed(4);
  const dsc = ex.dynoScaledColumn.toFixed(4);
  const bracketStr = ex.bracket.toFixed(4);
  const truncStr = ex.truncatedBracket.toFixed(2);
  const lines = [
    DYNO_POINTS_ABOVE_BASE_SYMBOLIC,
    '',
    'Substituted:',
    `  SP = ${sp}   (dyno scaled power)`,
    `  DSC = 112 − 4.25×(${ex.showroomWeightLbs} ÷ ${sp}) = ${dsc}`,
    `  FB = ${fb}   (= (⅔)×${ex.factoryRatedHp} + (⅓)×${ex.factoryRatedTorqueLbFt})`,
    `  CSP = 112 − 4.25×(${ex.showroomWeightLbs} ÷ ${fb}) = ${csp}`
  ];
  if (ex.usedCarScaledPowerFallback) {
    lines.push(`  bracket = DSC − CSP = ${bracketStr}`);
  } else {
    lines.push(
      `  PA = ${ex.performanceAdjustment}`,
      `  SA = ${ex.showroomAssessment!.toFixed(4)}`,
      `  bracket = DSC + PA − SA = ${bracketStr}`
    );
  }
  lines.push(`  truncated = INT(bracket×100) / 100 = ${truncStr}`, `  result = ${ex.result.toFixed(2)} pts`);
  if (ex.clampedToMinusTwo) {
    lines.push('', 'Truncated value is below −2, so the workbook floor of −2 pts applies.');
  }
  return lines.join('\n');
}
