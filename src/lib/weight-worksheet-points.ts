// Logical component: Weight worksheet assessment from competition weight vs catalog scaled weight/power row.

import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';

type WeightCatalogInput = Pick<
  ShowroomLookupRow,
  'factoryRatedHp' | 'factoryRatedTorqueLbFt' | 'performanceAdjustment' | 'showroomAssessment'
>;

/** COMSCC power blend (2/3 HP + 1/3 torque); same as showroom table, independent of vehicle weight. */
function powerBlendFromCatalog(catalog: WeightCatalogInput): number | null {
  const hp = catalog.factoryRatedHp;
  const tq = catalog.factoryRatedTorqueLbFt;
  if (hp === null || tq === null) return null;
  const pb = (2 / 3) * hp + (1 / 3) * tq;
  return Number.isFinite(pb) && pb > 0 ? pb : null;
}

/**
 * Sheet formula (left-associative): Competition / ((scaledW/P + perfAdj − showroom) × 100) / 100.
 * `scaledWeightPerPower` is recomputed from **competition** weight and catalog power blend so it moves when
 * competition weight ≠ showroom curb weight (catalog showroom row has SA = swp_showroom + pa, which would
 * otherwise zero the denominator).
 */
export function computeWeightSheetPoints(
  competitionWeightLbs: number,
  catalog: WeightCatalogInput | null | undefined
): number {
  if (!Number.isFinite(competitionWeightLbs) || competitionWeightLbs <= 0) return 0;
  if (!catalog) return 0;
  const pa = catalog.performanceAdjustment;
  const sa = catalog.showroomAssessment;
  if (pa === null || sa === null) return 0;
  if (!Number.isFinite(pa) || !Number.isFinite(sa)) return 0;

  const powerBlend = powerBlendFromCatalog(catalog);
  if (powerBlend === null) return 0;

  const weightPerPowerComp = competitionWeightLbs / powerBlend;
  const scaledWeightPerPowerComp = 112 - 4.25 * weightPerPowerComp;
  if (!Number.isFinite(scaledWeightPerPowerComp)) return 0;

  const bracket = scaledWeightPerPowerComp + pa - sa;
  const scaledDenom = bracket * 100;
  if (!Number.isFinite(scaledDenom) || Math.abs(scaledDenom) < 1e-12) return 0;
  const raw = competitionWeightLbs / scaledDenom / 100;
  return Number.isFinite(raw) ? raw : 0;
}
