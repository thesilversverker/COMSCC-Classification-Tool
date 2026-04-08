// Logical component: five-tier touring display (T5→T1) from in-app modification point subtotal.
// Note: Official COMSCC Total Assessment also includes showroom base points; this tier maps the summed worksheet-style modification points only until base assessment is wired in.

export const TIER_DISPLAY_ORDER = ['T5', 'T4', 'T3', 'T2', 'T1'] as const;
export type TouringDisplayTier = (typeof TIER_DISPLAY_ORDER)[number];

/** Upper bounds (exclusive) for T5–T2; T1 is all points at or above the T2 upper bound. Bands span a 0–110 style scale in equal steps. */
const TIER_UPPER_EXCLUSIVE: Record<'T5' | 'T4' | 'T3' | 'T2', number> = {
  T5: 22,
  T4: 44,
  T3: 66,
  T2: 88
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

/** Human-readable inclusive lower and upper for the tier strip (upper is inclusive for T5–T4–T3–T2; T1 has no upper). */
export function modificationPointsRangeLabel(tier: TouringDisplayTier): string {
  if (tier === 'T5') return `0 – ${(TIER_UPPER_EXCLUSIVE.T5 - 0.1).toFixed(1)}`;
  if (tier === 'T4')
    return `${TIER_UPPER_EXCLUSIVE.T5} – ${(TIER_UPPER_EXCLUSIVE.T4 - 0.1).toFixed(1)}`;
  if (tier === 'T3')
    return `${TIER_UPPER_EXCLUSIVE.T4} – ${(TIER_UPPER_EXCLUSIVE.T3 - 0.1).toFixed(1)}`;
  if (tier === 'T2')
    return `${TIER_UPPER_EXCLUSIVE.T3} – ${(TIER_UPPER_EXCLUSIVE.T2 - 0.1).toFixed(1)}`;
  return `${TIER_UPPER_EXCLUSIVE.T2}+`;
}
