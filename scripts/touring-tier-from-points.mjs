// Logical component: single source for T5–T1 band cutoffs (modification strip + showroom baseClassification).

/** Inclusive display maxima (pts) for range labels. */
export const TIER_MAX_INCLUSIVE = Object.freeze({
  T5: 44.9,
  T4: 59.9,
  T3: 74.9,
  T2: 94.9,
  T1: 120
});

/** Exclusive upper bound: points strictly below this fall in the band. */
export const TIER_UPPER_EXCLUSIVE = Object.freeze({
  T5: 45,
  T4: 60,
  T3: 75,
  T2: 95
});

/**
 * @param {number} total
 * @returns {'T5' | 'T4' | 'T3' | 'T2' | 'T1'}
 */
export function tierFromPoints(total) {
  const t = Number.isFinite(total) ? total : 0;
  if (t < TIER_UPPER_EXCLUSIVE.T5) return 'T5';
  if (t < TIER_UPPER_EXCLUSIVE.T4) return 'T4';
  if (t < TIER_UPPER_EXCLUSIVE.T3) return 'T3';
  if (t < TIER_UPPER_EXCLUSIVE.T2) return 'T2';
  return 'T1';
}

/**
 * @param {number | null | undefined} showroomAssessment
 * @returns {string | null}
 */
export function baseClassificationFromShowroomAssessment(showroomAssessment) {
  if (typeof showroomAssessment !== 'number' || !Number.isFinite(showroomAssessment)) return null;
  return tierFromPoints(showroomAssessment);
}
