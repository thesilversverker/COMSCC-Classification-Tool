// Logical component: human-readable session summary + CSV rows — mirrors category scoring in scoring.ts.

import showroomLookup from '$data/vehicle-showroom-lookup.json';
import comsccCatalogJson from '../../rules-source/vehicles-comscc-catalog.json';
import type { ComsccCatalogSeedRow } from '$lib/comscc-catalog-trims';
import { dynoPointsAboveBaseFromSession } from '$lib/dyno-reclass-math';
import { averageTireWidthMmFromAnswers } from '$lib/tire-width-points';
import { touringTierFromModificationPoints } from '$lib/touring-tiers';
import { computeWeightSheetPoints } from '$lib/weight-worksheet-points';
import { resolveShowroomForSession, type ComsccCatalogDocument } from '$lib/comscc-seed-showroom';
import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';
import type { RuleAnswersByQuestionId, RuleCategory, RuleQuestion } from '$types/rules';
import {
  computeAllCategoryPoints,
  computeCategoryPoints,
  engineDynoSupersedesModificationPoints,
  questionStandardPointContribution,
  resolveSelectedOption,
  sumCategoryPoints,
  sumPointsFromQuestions
} from '$lib/scoring';

const SHOWROOM_LOOKUP_ROWS = (showroomLookup as { rows: ShowroomLookupRow[] }).rows;

const COMSCC_CATALOG_DOC = comsccCatalogJson as ComsccCatalogDocument;

const COMSCC_VEHICLE_CATALOG: ComsccCatalogSeedRow[] = Array.isArray(
  (comsccCatalogJson as { vehicleCatalog?: unknown }).vehicleCatalog
)
  ? (comsccCatalogJson as { vehicleCatalog: ComsccCatalogSeedRow[] }).vehicleCatalog
  : [];

const ENGINE_DYNO_TOGGLE_ID = 'dyno_reclass_selected';

export type SessionSummaryRow = {
  categoryId: string;
  categoryLabel: string;
  label: string;
  detail?: string;
  /** null when the row is informational (no worksheet points). */
  points: number | null;
};

export type SessionSummaryPayload = {
  vehicleLine: string;
  competitionWeightDisplay: string;
  finalClass: string;
  grandModificationPoints: number;
  rows: SessionSummaryRow[];
};

function toNumeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Logical component: single-line vehicle description from session answers. */
export function formatVehicleSummaryLine(answers: RuleAnswersByQuestionId): string {
  const make = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label.trim() : '';
  const model = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label.trim() : '';
  const year = typeof answers.vehicles_year === 'string' ? answers.vehicles_year.trim() : '';
  const trim = typeof answers.vehicles_trim_label === 'string' ? answers.vehicles_trim_label.trim() : '';
  if (!make && !model) return 'No vehicle selected';
  const core = [make, model, year].filter(Boolean).join(' ');
  return trim ? `${core} (${trim})` : core;
}

function formatCompetitionWeightDisplay(answers: RuleAnswersByQuestionId): string {
  const v = answers.weight_competition;
  if (typeof v === 'number' && Number.isFinite(v)) return `${v} lbs`;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return `${n} lbs`;
    return `${v.trim()} lbs`;
  }
  return '—';
}

function questionHasSelection(q: RuleQuestion, answers: RuleAnswersByQuestionId): boolean {
  const value = answers[q.id];
  const manual = answers[`${q.id}__manual`];
  const qty = answers[`${q.id}__quantity`];
  if (q.answerType === 'boolean') {
    return value === true || (typeof manual === 'number' && Number.isFinite(manual));
  }
  if (q.answerType === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (q.answerType === 'select') {
    return typeof value === 'string' && value.length > 0;
  }
  if (q.answerType === 'text') {
    return typeof value === 'string' && value.trim().length > 0;
  }
  return false;
}

function rowLabelForQuestion(q: RuleQuestion, answers: RuleAnswersByQuestionId): string {
  if (q.answerType === 'select') {
    const opt = resolveSelectedOption(q, answers);
    if (opt?.label) return `${q.prompt}: ${opt.label}`;
  }
  return q.prompt;
}

function pushQuestionRowsForCategory(
  rows: SessionSummaryRow[],
  category: RuleCategory,
  answers: RuleAnswersByQuestionId,
  skipIds: ReadonlySet<string>
) {
  for (const q of category.questions) {
    if (skipIds.has(q.id)) continue;
    const pts = questionStandardPointContribution(q, answers);
    const selected = questionHasSelection(q, answers);
    if (!selected && Math.abs(pts) < 1e-9) continue;
    rows.push({
      categoryId: category.id,
      categoryLabel: category.label,
      label: rowLabelForQuestion(q, answers),
      detail: undefined,
      points: pts
    });
  }
}

/** Logical component: showroom vehicles line + per-category scoring lines aligned with computeCategoryPoints. */
export function buildSessionSummaryPayload(
  categories: RuleCategory[],
  answers: RuleAnswersByQuestionId
): SessionSummaryPayload {
  const categoryPoints = computeAllCategoryPoints(categories, answers);
  const grand = sumCategoryPoints(categoryPoints);
  const finalClass = touringTierFromModificationPoints(grand);
  const match = resolveShowroomForSession(answers, SHOWROOM_LOOKUP_ROWS, COMSCC_CATALOG_DOC, COMSCC_VEHICLE_CATALOG);

  const rows: SessionSummaryRow[] = [];

  // Logical component: Vehicles — single showroom assessment line (same total as scoring).
  const vehiclesCat = categories.find((c) => c.id === 'vehicles');
  const vehiclesPts = categoryPoints.vehicles ?? 0;
  const hasNumericShowroom =
    match &&
    typeof match.showroomAssessment === 'number' &&
    Number.isFinite(match.showroomAssessment);
  if (hasNumericShowroom && match.comsccEnriched === true) {
    rows.push({
      categoryId: 'vehicles',
      categoryLabel: vehiclesCat?.label ?? 'Vehicles',
      label: 'Showroom assessment (catalog match)',
      detail: match.catalogId ? `Catalog id: ${match.catalogId}` : undefined,
      points: vehiclesPts
    });
  } else if (hasNumericShowroom) {
    rows.push({
      categoryId: 'vehicles',
      categoryLabel: vehiclesCat?.label ?? 'Vehicles',
      label: 'Showroom assessment (unevaluated vehicle)',
      detail: match.catalogId ? `Catalog id: ${match.catalogId}` : undefined,
      points: vehiclesPts
    });
  } else {
    rows.push({
      categoryId: 'vehicles',
      categoryLabel: vehiclesCat?.label ?? 'Vehicles',
      label: 'Showroom assessment (manual)',
      points: vehiclesPts
    });
  }

  // Logical component: Weight — competition weight (info) + worksheet + other weight questions.
  const weightCat = categories.find((c) => c.id === 'weight');
  if (weightCat) {
    const sheetPts = computeWeightSheetPoints(toNumeric(answers.weight_competition), match);
    rows.push({
      categoryId: 'weight',
      categoryLabel: weightCat.label,
      label: 'Weight worksheet (competition vs catalog)',
      points: sheetPts
    });
    const skipWeight = new Set<string>(['weight_showroom', 'weight_competition']);
    for (const q of weightCat.questions) {
      if (skipWeight.has(q.id)) continue;
      const pts = questionStandardPointContribution(q, answers);
      const selected = questionHasSelection(q, answers);
      if (!selected && Math.abs(pts) < 1e-9) continue;
      rows.push({
        categoryId: weightCat.id,
        categoryLabel: weightCat.label,
        label: rowLabelForQuestion(q, answers),
        points: pts
      });
    }
  }

  const engineCat = categories.find((c) => c.id === 'engine');
  if (engineCat) {
    if (engineDynoSupersedesModificationPoints(engineCat.questions, answers)) {
      const dynoPts =
        dynoPointsAboveBaseFromSession({
          answers,
          showroomBaseWeightLbs: match?.showroomBaseWeightLbs ?? null,
          factoryRatedHp: match?.factoryRatedHp ?? null,
          factoryRatedTorqueLbFt: match?.factoryRatedTorqueLbFt ?? null,
          performanceAdjustment: match?.performanceAdjustment ?? null,
          showroomAssessment: match?.showroomAssessment ?? null
        }) ?? 0;
      rows.push({
        categoryId: engineCat.id,
        categoryLabel: engineCat.label,
        label: 'Engine (dyno reclass assessment)',
        points: dynoPts
      });
    } else {
      pushQuestionRowsForCategory(rows, engineCat, answers, new Set([ENGINE_DYNO_TOGGLE_ID]));
    }
  }

  for (const category of categories) {
    if (category.id === 'vehicles' || category.id === 'weight' || category.id === 'engine') continue;
    if (category.id === 'tires') {
      const modelPts = sumPointsFromQuestions(category.questions, answers);
      const tiresTotal = computeCategoryPoints(category, answers, categories);
      const widthPts = tiresTotal - modelPts;
      pushQuestionRowsForCategory(rows, category, answers, new Set());
      const avg = averageTireWidthMmFromAnswers(answers);
      if (avg !== null || Math.abs(widthPts) > 1e-9) {
        rows.push({
          categoryId: category.id,
          categoryLabel: category.label,
          label: 'Tire width vs class spec ((avg width − spec) × 0.05)',
          detail: avg !== null ? `Effective width ${avg} mm` : undefined,
          points: widthPts
        });
      }
      continue;
    }
    pushQuestionRowsForCategory(rows, category, answers, new Set());
  }

  return {
    vehicleLine: formatVehicleSummaryLine(answers),
    competitionWeightDisplay: formatCompetitionWeightDisplay(answers),
    finalClass,
    grandModificationPoints: grand,
    rows
  };
}

/** Logical component: RFC 4180–style CSV (quoted fields, CRLF optional — use \n only for simplicity). */
export function sessionSummaryToCsv(payload: SessionSummaryPayload): string {
  const lines: string[][] = [
    ['Field', 'Value'],
    ['Vehicle', payload.vehicleLine],
    ['Competition weight', payload.competitionWeightDisplay],
    ['Final class', payload.finalClass],
    ['Total modification points', String(payload.grandModificationPoints)]
  ];

  const esc = (s: string) => {
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const body = lines.map((r) => r.map(esc).join(',')).join('\n');
  const header = ['Category', 'Item', 'Detail', 'Points'].map(esc).join(',');
  const detailRows = payload.rows.map((r) =>
    [r.categoryLabel, r.label, r.detail ?? '', r.points === null ? '' : String(r.points)].map(esc).join(',')
  );
  return `${body}\n\n${header}\n${detailRows.join('\n')}`;
}
