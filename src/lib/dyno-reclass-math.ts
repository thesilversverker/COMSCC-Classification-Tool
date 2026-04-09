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

/**
 * Points above base car assessment from workbook-style showroom vs dyno scaled power.
 * raw = (weight/scaledPower)*(-4.25) + 112 - factoryPowerBlend; clamp to >= -2.
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
  const factoryBlend = hp * (2 / 3) + tq * (1 / 3);
  const raw = (w / sp) * -4.25 + 112 - factoryBlend;
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
