/**
 * Logical component: when composed showroom lookup misses (e.g. COMSCC trim slug ≠ VPIC style key),
 * resolve showroom scalars from vehicles-comscc-catalog.json using the same pickComsccRow + derive chain as compose.
 */

import { computeComsccDerivedFields } from '../../scripts/comscc-derived-fields.mjs';
import { pickComsccRow } from '../../scripts/build-showroom-lookup-rows.mjs';
import type { ComsccCatalogSeedRow } from '$lib/comscc-catalog-trims';
import { COMSCC_TRIM_BASE_SENTINEL } from '$lib/comscc-catalog-trims';
import { baseClassificationFromShowroomAssessment } from '$lib/touring-tiers';
import { findShowroomCatalogMatch, normVehicleToken, type ShowroomLookupRow } from '$lib/vehicles-showroom-match';
import type { RuleAnswersByQuestionId } from '$types/rules';

/** Same scalar merge as compose-vehicles-json mergeScalarsForTemplate. */
function mergeScalarsForTemplate(
  template: Record<string, unknown>,
  override: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const t = template ?? {};
  const o = override ?? {};
  const keys = ['showroomBaseWeightLbs', 'factoryRatedHp', 'factoryRatedTorqueLbFt', 'suspIndex'] as const;
  const out: Record<string, unknown> = { ...t };
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function trimFromAnswers(answers: RuleAnswersByQuestionId): string | null {
  const t = answers.vehicles_trim_key;
  if (t === COMSCC_TRIM_BASE_SENTINEL) return null;
  if (typeof t !== 'string' || t === '') return null;
  return t;
}

function catalogRowToSyntheticLookup(
  seed: Record<string, unknown>,
  mergedScalars: Record<string, unknown>,
  derived: ReturnType<typeof computeComsccDerivedFields>,
  makeLabel: string,
  modelLabel: string,
  year: number,
  sessionTrim: string | null
): ShowroomLookupRow {
  const showroomAssessment = derived.showroomAssessment;
  const baseClassification = baseClassificationFromShowroomAssessment(showroomAssessment);
  const rawId =
    typeof seed.id === 'string' && seed.id.length > 0
      ? seed.id
      : `comscc_seed_${normVehicleToken(makeLabel)}_${normVehicleToken(modelLabel)}_${year}_${sessionTrim ? normVehicleToken(sessionTrim) : 'base'}`;

  return {
    makeNorm: normVehicleToken(makeLabel),
    modelNorm: normVehicleToken(modelLabel),
    year,
    trimKey: sessionTrim,
    showroomAssessment,
    scaledWeightPerPower: derived.scaledWeightPerPower ?? null,
    performanceAdjustment: derived.performanceAdjustment ?? null,
    showroomBaseWeightLbs: num(mergedScalars.showroomBaseWeightLbs),
    factoryRatedHp: num(mergedScalars.factoryRatedHp),
    factoryRatedTorqueLbFt: num(mergedScalars.factoryRatedTorqueLbFt),
    baseClassification,
    catalogId: rawId,
    comsccEnriched: true,
    showroomSource: 'comscc_seed'
  };
}

export type ComsccCatalogDocument = {
  comsccTemplate?: Record<string, unknown>;
  vehicleCatalog?: ComsccCatalogSeedRow[];
};

/**
 * Prefer composed lookup row; if missing or no finite Showroom Assessment, derive from COMSCC seed + template (compose parity).
 */
export function resolveShowroomForSession(
  answers: RuleAnswersByQuestionId,
  lookupRows: ShowroomLookupRow[],
  catalogDoc: ComsccCatalogDocument | null | undefined,
  comsccVehicleCatalog?: readonly ComsccCatalogSeedRow[] | null
): ShowroomLookupRow | null {
  const lookupMatch = findShowroomCatalogMatch(answers, lookupRows, comsccVehicleCatalog);
  if (
    lookupMatch &&
    typeof lookupMatch.showroomAssessment === 'number' &&
    Number.isFinite(lookupMatch.showroomAssessment)
  ) {
    return lookupMatch;
  }

  const catalog = catalogDoc?.vehicleCatalog;
  const template = catalogDoc?.comsccTemplate;
  if (!Array.isArray(catalog) || catalog.length === 0 || typeof template !== 'object' || template === null) {
    return lookupMatch;
  }

  const makeLabel = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label : '';
  const modelLabel = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label : '';
  const yearStr = typeof answers.vehicles_year === 'string' ? answers.vehicles_year.trim() : '';
  if (!makeLabel || !modelLabel || yearStr.length !== 4) {
    return lookupMatch;
  }

  const year = Number(yearStr);
  if (!Number.isInteger(year)) {
    return lookupMatch;
  }

  const sessionTrim = trimFromAnswers(answers);
  const seed = pickComsccRow(
    makeLabel,
    modelLabel,
    year,
    catalog,
    sessionTrim ?? undefined
  ) as Record<string, unknown> | null;
  if (!seed) {
    return lookupMatch;
  }

  const merged = mergeScalarsForTemplate(template, seed);
  const derived = computeComsccDerivedFields(merged);

  const synthetic = catalogRowToSyntheticLookup(seed, merged, derived, makeLabel, modelLabel, year, sessionTrim);
  if (synthetic.showroomAssessment === null || !Number.isFinite(synthetic.showroomAssessment)) {
    return lookupMatch;
  }

  return synthetic;
}
