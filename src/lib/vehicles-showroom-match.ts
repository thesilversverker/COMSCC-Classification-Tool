// Logical component: match session vehicle picks to merged vehicle catalog lookup rows.
import {
  comsccTrimChoicesForYear,
  COMSCC_TRIM_BASE_SENTINEL,
  type ComsccCatalogSeedRow
} from '$lib/comscc-catalog-trims';
import type { RuleAnswersByQuestionId } from '$types/rules';

export type ShowroomLookupRow = {
  makeNorm: string;
  modelNorm: string;
  year: number | null;
  /** Present when open-vehicle-db row used a model_styles entry; otherwise null. */
  trimKey: string | null;
  showroomAssessment: number | null;
  /** From composed vehicle row; used by Weight worksheet points formula. */
  scaledWeightPerPower: number | null;
  performanceAdjustment: number | null;
  showroomBaseWeightLbs: number | null;
  factoryRatedHp: number | null;
  factoryRatedTorqueLbFt: number | null;
  baseClassification: string | null;
  catalogId: string;
  /** True when a COMSCC seed row matched this open-db make/model/year (narrowest year span). */
  comsccEnriched?: boolean;
};

export function normVehicleToken(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function trimFromAnswers(answers: RuleAnswersByQuestionId): string | null {
  const t = answers.vehicles_trim_key;
  if (t === COMSCC_TRIM_BASE_SENTINEL) return null;
  if (typeof t !== 'string' || t === '') return null;
  return t;
}

/**
 * Exact match on make, model, year, and trim (both sides null or same string).
 * @param comsccVehicleCatalog optional `vehicles-comscc-catalog.json` `vehicleCatalog` — when set, suppresses a match until a trim choice is made for years that require one.
 */
export function findShowroomCatalogMatch(
  answers: RuleAnswersByQuestionId,
  rows: ShowroomLookupRow[],
  comsccVehicleCatalog?: readonly ComsccCatalogSeedRow[] | null
): ShowroomLookupRow | null {
  const makeLabel = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label : '';
  const modelLabel = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label : '';
  const yearStr = typeof answers.vehicles_year === 'string' ? answers.vehicles_year.trim() : '';

  if (!makeLabel || !modelLabel || yearStr.length !== 4) return null;

  const year = Number(yearStr);
  if (!Number.isInteger(year)) return null;

  const trimChoices =
    comsccVehicleCatalog != null
      ? comsccTrimChoicesForYear(comsccVehicleCatalog, makeLabel, modelLabel, year)
      : [];
  if (trimChoices.length > 0) {
    const raw = answers.vehicles_trim_key;
    if (raw === '' || raw === undefined || raw === null) return null;
  }

  const mMake = normVehicleToken(makeLabel);
  const mModel = normVehicleToken(modelLabel);
  const sessionTrim = trimFromAnswers(answers);

  const candidates = rows.filter((r) => {
    if (r.makeNorm !== mMake || r.modelNorm !== mModel) return false;
    if (r.year !== year) return false;
    const rowTrim = r.trimKey;
    if (sessionTrim === null && rowTrim === null) return true;
    if (sessionTrim !== null && rowTrim !== null && sessionTrim === rowTrim) return true;
    return false;
  });

  return candidates.length > 0 ? candidates[0] : null;
}
