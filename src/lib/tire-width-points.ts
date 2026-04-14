// Logical component: effective tire width (mm) from session + width-vs-spec points (COMSCC-style delta × 0.05).

import type { RuleAnswersByQuestionId } from '$types/rules';
import { specTireWidthMmForTier, touringTierFromModificationPoints } from '$lib/touring-tiers';

/** Parse a single optional width field from session (number or numeric string). */
export function parseOptionalTireWidthMm(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Average of primary and stagger when both set; otherwise whichever width is entered.
 * Returns null when no width is entered (no width line points).
 */
export function averageTireWidthMmFromAnswers(answers: RuleAnswersByQuestionId): number | null {
  const primary = parseOptionalTireWidthMm(answers.tires_width_mm);
  const stagger = parseOptionalTireWidthMm(answers.tires_width_stagger_mm);
  if (primary !== null && stagger !== null) return (primary + stagger) / 2;
  return primary ?? stagger ?? null;
}

/** Workbook rule: (average width − spec width for class) × 0.05 modification points. */
export function tireWidthDeltaPoints(averageMm: number, specMm: number): number {
  return (averageMm - specMm) * 0.05;
}

/**
 * Width-line points for a given modification subtotal (used to resolve spec tier).
 * When no average width is entered, returns 0.
 */
export function tireWidthLinePointsForGrandTotal(
  answers: RuleAnswersByQuestionId,
  grandForTier: number
): number {
  const avg = averageTireWidthMmFromAnswers(answers);
  if (avg === null) return 0;
  const tier = touringTierFromModificationPoints(grandForTier);
  const specMm = specTireWidthMmForTier(tier);
  return tireWidthDeltaPoints(avg, specMm);
}
