// Logical component: five-tier touring display (T5→T1) from in-app modification point subtotal.
// Note: Official COMSCC Total Assessment also includes showroom base points; this tier maps the summed worksheet-style modification points only until base assessment is wired in.

import {
  TIER_MAX_INCLUSIVE,
  TIER_UPPER_EXCLUSIVE,
  tierFromPoints
} from '../../scripts/touring-tier-from-points.mjs';

export const TIER_DISPLAY_ORDER = ['T5', 'T4', 'T3', 'T2', 'T1'] as const;
export type TouringDisplayTier = (typeof TIER_DISPLAY_ORDER)[number];

const tierMax = TIER_MAX_INCLUSIVE as Record<TouringDisplayTier, number>;
const tierUpper = TIER_UPPER_EXCLUSIVE as Record<'T5' | 'T4' | 'T3' | 'T2', number>;

// Logical component: reference standard tire widths (mm) by tier for future width-delta rules — approximate mapping from COMSCC tire-width chart (T30–T100 style progression).
const SPEC_TIRE_WIDTH_MM: Record<TouringDisplayTier, number> = {
  T5: 185,
  T4: 205,
  T3: 225,
  T2: 275,
  T1: 315
};

export function touringTierFromModificationPoints(total: number): TouringDisplayTier {
  return tierFromPoints(Number.isFinite(total) ? total : 0) as TouringDisplayTier;
}

/** Base class label (T5–T1) from showroom assessment using the same point bands as the modification tier strip. */
export function baseClassificationFromShowroomAssessment(
  showroomAssessment: number | null | undefined
): string | null {
  if (typeof showroomAssessment !== 'number' || !Number.isFinite(showroomAssessment)) return null;
  return tierFromPoints(showroomAssessment);
}

export function specTireWidthMmForTier(tier: TouringDisplayTier): number {
  return SPEC_TIRE_WIDTH_MM[tier];
}

/** Human-readable inclusive point range for each tier cell in the strip (T1 capped at workbook-style max). */
export function modificationPointsRangeLabel(tier: TouringDisplayTier): string {
  if (tier === 'T5') return `0 – ${tierMax.T5}`;
  if (tier === 'T4') return `${tierUpper.T5} – ${tierMax.T4}`;
  if (tier === 'T3') return `${tierUpper.T4} – ${tierMax.T3}`;
  if (tier === 'T2') return `${tierUpper.T3} – ${tierMax.T2}`;
  return `${tierUpper.T2} – ${tierMax.T1}`;
}
