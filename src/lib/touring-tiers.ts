// Logical component: five-tier touring display (T5→T1) from in-app modification point subtotal.
// Note: Official COMSCC Total Assessment also includes showroom base points; this tier maps the summed worksheet-style modification points only until base assessment is wired in.

export const TIER_DISPLAY_ORDER = ['T5', 'T4', 'T3', 'T2', 'T1'] as const;
export type TouringDisplayTier = (typeof TIER_DISPLAY_ORDER)[number];

// Logical component: inclusive display maxima (pts) — bands are contiguous; next tier starts at prior max + 0.1 step (e.g. T5 ends 44.9, T4 starts 45).
const TIER_MAX_INCLUSIVE: Record<TouringDisplayTier, number> = {
  T5: 44.9,
  T4: 59.9,
  T3: 74.9,
  T2: 94.9,
  T1: 120
};

/** Exclusive upper bound for tier assignment: points strictly below this value fall in the band. */
const TIER_UPPER_EXCLUSIVE: Record<'T5' | 'T4' | 'T3' | 'T2', number> = {
  T5: 45,
  T4: 60,
  T3: 75,
  T2: 95
};

// Logical component: reference standard tire widths (mm) by tier for future width-delta rules — approximate mapping from COMSCC tire-width chart (T30–T100 style progression).
const SPEC_TIRE_WIDTH_MM: Record<TouringDisplayTier, number> = {
  T5: 185,
  T4: 205,
  T3: 225,
  T2: 275,
  T1: 315
};

export function touringTierFromModificationPoints(total: number): TouringDisplayTier {
  const t = Number.isFinite(total) ? total : 0;
  if (t < TIER_UPPER_EXCLUSIVE.T5) return 'T5';
  if (t < TIER_UPPER_EXCLUSIVE.T4) return 'T4';
  if (t < TIER_UPPER_EXCLUSIVE.T3) return 'T3';
  if (t < TIER_UPPER_EXCLUSIVE.T2) return 'T2';
  return 'T1';
}

export function specTireWidthMmForTier(tier: TouringDisplayTier): number {
  return SPEC_TIRE_WIDTH_MM[tier];
}

/** Human-readable inclusive point range for each tier cell in the strip (T1 capped at workbook-style max). */
export function modificationPointsRangeLabel(tier: TouringDisplayTier): string {
  if (tier === 'T5') return `0 – ${TIER_MAX_INCLUSIVE.T5}`;
  if (tier === 'T4') return `${TIER_UPPER_EXCLUSIVE.T5} – ${TIER_MAX_INCLUSIVE.T4}`;
  if (tier === 'T3') return `${TIER_UPPER_EXCLUSIVE.T4} – ${TIER_MAX_INCLUSIVE.T3}`;
  if (tier === 'T2') return `${TIER_UPPER_EXCLUSIVE.T3} – ${TIER_MAX_INCLUSIVE.T2}`;
  return `${TIER_UPPER_EXCLUSIVE.T2} – ${TIER_MAX_INCLUSIVE.T1}`;
}
