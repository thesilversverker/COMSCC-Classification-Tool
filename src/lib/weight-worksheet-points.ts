// Logical component: Weight worksheet assessment from competition weight vs catalog scaled weight/power row.

import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';

type WeightCatalogScalars = Pick<
  ShowroomLookupRow,
  'scaledWeightPerPower' | 'performanceAdjustment' | 'showroomAssessment'
>;

/**
 * Sheet formula (left-associative): Competition / ((swp + perfAdj − showroom) × 100) / 100.
 * Uses catalog `scaledWeightPerPower`, `performanceAdjustment`, and `showroomAssessment` from the matched vehicle row.
 */
export function computeWeightSheetPoints(
  competitionWeightLbs: number,
  catalog: WeightCatalogScalars | null | undefined
): number {
  if (!Number.isFinite(competitionWeightLbs) || competitionWeightLbs <= 0) return 0;
  if (!catalog) return 0;
  const swp = catalog.scaledWeightPerPower;
  const pa = catalog.performanceAdjustment;
  const sa = catalog.showroomAssessment;
  if (swp === null || pa === null || sa === null) return 0;
  if (!Number.isFinite(swp) || !Number.isFinite(pa) || !Number.isFinite(sa)) return 0;
  const bracket = swp + pa - sa;
  const scaledDenom = bracket * 100;
  if (!Number.isFinite(scaledDenom) || scaledDenom === 0) return 0;
  const raw = competitionWeightLbs / scaledDenom / 100;
  return Number.isFinite(raw) ? raw : 0;
}
