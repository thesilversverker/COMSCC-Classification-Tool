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
 * Workbook: INT(((Competition/(2/3*HP+1/3*Tq))*-4.25+112+PerfAdj−ShowroomPoints)*100)/100
 * — i.e. `scaledWeightPerPower` from **competition** weight, plus performance adjustment, minus showroom
 * assessment, truncated to hundredths (Excel INT toward −∞ on the ×100 product).
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

  // Logical component: bracket = scaled W/P + performance column − showroom assessment (same units as sheet).
  const bracket = scaledWeightPerPowerComp + pa - sa;
  if (!Number.isFinite(bracket)) return 0;
  // Logical component: match Excel INT(x) === ⌊x⌋ for the scaled product before ÷100.
  return Math.floor(bracket * 100) / 100;
}
