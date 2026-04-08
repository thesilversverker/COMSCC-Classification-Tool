// Logical component: match session vehicle picks to COMSCC showroom catalog rows (from workbook / rules-source).
import type { RuleAnswersByQuestionId } from '$types/rules';

export type ShowroomLookupRow = {
  makeNorm: string;
  modelNorm: string;
  startYear: number | null;
  endYear: number | null;
  showroomAssessment: number | null;
  showroomBaseWeightLbs: number | null;
  baseClassification: string | null;
  catalogId: string;
};

export function normVehicleToken(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function yearSpanWidth(r: ShowroomLookupRow): number {
  const sy = r.startYear ?? 1900;
  const ey = r.endYear ?? 2100;
  return Math.max(0, ey - sy);
}

/** Pick the tightest year-range row among ties (same make/model/year). */
export function findShowroomCatalogMatch(
  answers: RuleAnswersByQuestionId,
  rows: ShowroomLookupRow[]
): ShowroomLookupRow | null {
  const makeLabel = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label : '';
  const modelLabel = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label : '';
  const yearStr = typeof answers.vehicles_year === 'string' ? answers.vehicles_year.trim() : '';

  if (!makeLabel || !modelLabel || yearStr.length !== 4) return null;

  const year = Number(yearStr);
  if (!Number.isInteger(year)) return null;

  const mMake = normVehicleToken(makeLabel);
  const mModel = normVehicleToken(modelLabel);

  const candidates = rows.filter((r) => {
    if (r.makeNorm !== mMake || r.modelNorm !== mModel) return false;
    const sy = r.startYear;
    const ey = r.endYear;
    if (sy !== null && year < sy) return false;
    if (ey !== null && year > ey) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (yearSpanWidth(r) < yearSpanWidth(best) ? r : best));
}
