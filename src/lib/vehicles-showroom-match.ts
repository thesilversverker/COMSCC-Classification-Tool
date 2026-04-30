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

/** Same canonical form as compose `pickComsccRow` / vehicle `trimKey` ids (dots → underscores, etc.). */
function slugifyTrimKey(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function trimKeysMatch(sessionTrim: string | null, rowTrim: string | null): boolean {
  if (sessionTrim === null && rowTrim === null) return true;
  if (sessionTrim === null || rowTrim === null) return false;
  if (sessionTrim === rowTrim) return true;
  return slugifyTrimKey(sessionTrim) === slugifyTrimKey(rowTrim);
}

function trimFromAnswers(answers: RuleAnswersByQuestionId): string | null {
  const t = answers.vehicles_trim_key;
  if (t === COMSCC_TRIM_BASE_SENTINEL) return null;
  if (typeof t !== 'string' || t === '') return null;
  return t;
}

/**
 * True when make, model, year, and (if required) trim are set — same gate as showroom matching / Vehicles picker flow.
 */
export function isVehicleSelectionComplete(
  answers: RuleAnswersByQuestionId,
  comsccVehicleCatalog?: readonly ComsccCatalogSeedRow[] | null
): boolean {
  const makeSlug = typeof answers.vehicles_make_slug === 'string' ? answers.vehicles_make_slug : '';
  const modelKey = typeof answers.vehicles_model_key === 'string' ? answers.vehicles_model_key : '';
  const yearRaw = answers.vehicles_year;
  const yearStr = typeof yearRaw === 'string' ? yearRaw.trim() : '';
  if (!makeSlug || !modelKey || yearStr.length !== 4) return false;

  const makeLabel = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label : '';
  const modelLabel = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label : '';
  const year = Number(yearStr);
  if (!makeLabel || !modelLabel || !Number.isInteger(year)) return false;

  const trimChoices =
    comsccVehicleCatalog != null
      ? comsccTrimChoicesForYear(comsccVehicleCatalog, makeLabel, modelLabel, year)
      : [];
  if (trimChoices.length === 0) return true;

  const raw = answers.vehicles_trim_key;
  return typeof raw === 'string' && raw !== '';
}

/**
 * Match on normalized make/model, year, and trim (null vs null, exact string, or slug-equivalent trim like `2.0T Quattro` vs `2.0t quattro`).
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
    return trimKeysMatch(sessionTrim, r.trimKey);
  });

  if (candidates.length === 0) return null;
  // Logical component: same (make, model, year, trim) can appear non-adjacently in the lookup array; prefer COMSCC-enriched row, then heavier curb (real catalog over template).
  if (candidates.length > 1) {
    candidates.sort((a, b) => {
      const ae = a.comsccEnriched === true ? 1 : 0;
      const be = b.comsccEnriched === true ? 1 : 0;
      if (be !== ae) return be - ae;
      const aw = a.showroomBaseWeightLbs ?? 0;
      const bw = b.showroomBaseWeightLbs ?? 0;
      return bw - aw;
    });
  }
  return candidates[0];
}
