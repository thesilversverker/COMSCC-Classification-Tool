// Logical component: category point totals from session answers (shared by nav and main view).
import showroomLookup from '$data/vehicle-showroom-lookup.json';
import comsccCatalogJson from '../../rules-source/vehicles-comscc-catalog.json';
import type { ComsccCatalogSeedRow } from '$lib/comscc-catalog-trims';
import { dynoPointsAboveBaseFromSession } from '$lib/dyno-reclass-math';
import { computeWeightSheetPoints } from '$lib/weight-worksheet-points';
import { findShowroomCatalogMatch, type ShowroomLookupRow } from '$lib/vehicles-showroom-match';
import type { RuleAnswer, RuleAnswersByQuestionId, RuleCategory, RuleQuestion } from '$types/rules';

const SHOWROOM_LOOKUP_ROWS = (showroomLookup as { rows: ShowroomLookupRow[] }).rows;

const COMSCC_VEHICLE_CATALOG: ComsccCatalogSeedRow[] = Array.isArray(
  (comsccCatalogJson as { vehicleCatalog?: unknown }).vehicleCatalog
)
  ? (comsccCatalogJson as { vehicleCatalog: ComsccCatalogSeedRow[] }).vehicleCatalog
  : [];

function toNumeric(value: RuleAnswer): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const ENGINE_DYNO_TOGGLE_ID = 'dyno_reclass_selected';

/** Mirrors +page engine dyno trigger: dyno-only checkboxes, or any `needsManualPoints` line with a substantive answer. */
function engineManualSheetTrigger(questions: RuleQuestion[], answers: RuleAnswersByQuestionId): boolean {
  for (const q of questions) {
    if (q.id === ENGINE_DYNO_TOGGLE_ID) continue;
    if (q.answerType === 'boolean' && q.dynoReclassTrigger === true && answers[q.id] === true) return true;
    if (!q.needsManualPoints) continue;
    if (questionHasSubstantiveAnswer(q, answers)) return true;
  }
  return false;
}

function questionHasSubstantiveAnswer(q: RuleQuestion, answers: RuleAnswersByQuestionId): boolean {
  const value = answers[q.id];
  const manual = answers[`${q.id}__manual`];
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

/** Dyno/custom power path: engine category total is dyno vs showroom only; sheet checkboxes are not summed. */
function engineDynoSupersedesModificationPoints(
  questions: RuleQuestion[],
  answers: RuleAnswersByQuestionId
): boolean {
  const v = answers[ENGINE_DYNO_TOGGLE_ID];
  if (v === 'yes' || v === true) return true;
  return engineManualSheetTrigger(questions, answers);
}

function resolveSelectedOption(question: RuleQuestion, answers: RuleAnswersByQuestionId) {
  const selectedValue = answers[question.id];
  if (typeof selectedValue !== 'string' || selectedValue === '') {
    return undefined;
  }

  if (question.dependsOn && question.optionsByParent) {
    const parent = answers[question.dependsOn];
    if (typeof parent !== 'string') {
      return undefined;
    }
    return (question.optionsByParent[parent] ?? []).find((opt) => opt.id === selectedValue);
  }

  return (question.options ?? []).find((opt) => opt.id === selectedValue);
}

function addPointsFromQuestion(
  total: number,
  q: RuleQuestion,
  answers: RuleAnswersByQuestionId
): number {
  let t = total;
  if (q.answerType === 'boolean' && answers[q.id] === true) {
    if (q.pointQuantityMultiplier === true && typeof q.pointValue === 'number') {
      const qtyRaw = answers[`${q.id}__quantity`];
      const qty =
        typeof qtyRaw === 'number' && Number.isFinite(qtyRaw)
          ? Math.max(0, Math.floor(qtyRaw))
          : 1;
      t += q.pointValue * qty;
    } else if (typeof q.pointValue === 'number') {
      t += q.pointValue;
    } else if (q.needsManualPoints) {
      t += toNumeric(answers[`${q.id}__manual`] ?? 0);
    }
  }
  if (q.answerType === 'select') {
    const selectedOption = resolveSelectedOption(q, answers);
    if (typeof selectedOption?.points === 'number') {
      t += selectedOption.points;
    }
  }
  if (q.id.endsWith('_points')) {
    t += toNumeric(answers[q.id] ?? 0);
  }
  return t;
}

function sumPointsFromQuestions(
  questions: RuleQuestion[],
  answers: RuleAnswersByQuestionId,
  skipQuestionIds?: ReadonlySet<string>
): number {
  let total = 0;
  for (const q of questions) {
    if (skipQuestionIds?.has(q.id)) continue;
    total = addPointsFromQuestion(total, q, answers);
  }
  return total;
}

// Logical component: Vehicles category points = COMSCC catalog Showroom Assessment when matched, else manual entry.
function computeVehiclesCategoryPoints(answers: RuleAnswersByQuestionId): number {
  const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS, COMSCC_VEHICLE_CATALOG);
  if (match && typeof match.showroomAssessment === 'number' && Number.isFinite(match.showroomAssessment)) {
    return match.showroomAssessment;
  }
  return toNumeric(answers.vehicles_showroom_manual_points);
}

export function computeCategoryPoints(category: RuleCategory, answers: RuleAnswersByQuestionId): number {
  if (category.id === 'vehicles') {
    return computeVehiclesCategoryPoints(answers);
  }
  // Logical component: Weight = worksheet INT((scaledW/P+perf−showroom)×100)/100 from competition lbs + any checkbox/select points.
  if (category.id === 'weight') {
    const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS, COMSCC_VEHICLE_CATALOG);
    const base = computeWeightSheetPoints(toNumeric(answers.weight_competition), match);
    return base + sumPointsFromQuestions(category.questions, answers);
  }
  if (category.id === 'engine') {
    if (engineDynoSupersedesModificationPoints(category.questions, answers)) {
      const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS, COMSCC_VEHICLE_CATALOG);
      const computed = dynoPointsAboveBaseFromSession({
        answers,
        showroomBaseWeightLbs: match?.showroomBaseWeightLbs ?? null,
        factoryRatedHp: match?.factoryRatedHp ?? null,
        factoryRatedTorqueLbFt: match?.factoryRatedTorqueLbFt ?? null,
        performanceAdjustment: match?.performanceAdjustment ?? null,
        showroomAssessment: match?.showroomAssessment ?? null
      });
      return computed === null ? 0 : computed;
    }
    return sumPointsFromQuestions(category.questions, answers, new Set([ENGINE_DYNO_TOGGLE_ID]));
  }

  return sumPointsFromQuestions(category.questions, answers);
}

export function computeAllCategoryPoints(
  categories: RuleCategory[],
  answers: RuleAnswersByQuestionId
): Record<string, number> {
  return Object.fromEntries(categories.map((c) => [c.id, computeCategoryPoints(c, answers)]));
}

// Logical component: grand total of all category modification points shown in the classifier.
export function sumCategoryPoints(categoryPoints: Record<string, number>): number {
  let sum = 0;
  for (const v of Object.values(categoryPoints)) {
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}
