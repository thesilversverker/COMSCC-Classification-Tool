// Logical component: category point totals from session answers (shared by nav and main view).
import showroomLookup from '$data/vehicle-showroom-lookup.json';
import { dynoPointsAboveBaseFromSession } from '$lib/dyno-reclass-math';
import { computeWeightSheetPoints } from '$lib/weight-worksheet-points';
import { findShowroomCatalogMatch, type ShowroomLookupRow } from '$lib/vehicles-showroom-match';
import type { RuleAnswer, RuleAnswersByQuestionId, RuleCategory, RuleQuestion } from '$types/rules';

const SHOWROOM_LOOKUP_ROWS = (showroomLookup as { rows: ShowroomLookupRow[] }).rows;

function toNumeric(value: RuleAnswer): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

// Logical component: Vehicles category points = COMSCC catalog Showroom Assessment when matched, else manual entry.
function computeVehiclesCategoryPoints(answers: RuleAnswersByQuestionId): number {
  const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS);
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
    const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS);
    let total = computeWeightSheetPoints(toNumeric(answers.weight_competition), match);
    for (const q of category.questions) {
      if (q.answerType === 'boolean' && answers[q.id] === true) {
        if (typeof q.pointValue === 'number') {
          total += q.pointValue;
        } else if (q.needsManualPoints) {
          total += toNumeric(answers[`${q.id}__manual`] ?? 0);
        }
      }
      if (q.answerType === 'select') {
        const selectedOption = resolveSelectedOption(q, answers);
        if (typeof selectedOption?.points === 'number') {
          total += selectedOption.points;
        }
      }
      if (q.id.endsWith('_points')) {
        total += toNumeric(answers[q.id] ?? 0);
      }
    }
    return total;
  }
  // Logical component: when Dyno Reclass is selected, Engine points = computed dyno vs showroom baseline (floor −2).
  if (category.id === 'engine' && answers.dyno_reclass_selected === 'yes') {
    const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS);
    const computed = dynoPointsAboveBaseFromSession({
      answers,
      showroomBaseWeightLbs: match?.showroomBaseWeightLbs ?? null,
      factoryRatedHp: match?.factoryRatedHp ?? null,
      factoryRatedTorqueLbFt: match?.factoryRatedTorqueLbFt ?? null
    });
    return computed === null ? 0 : computed;
  }

  let total = 0;
  for (const q of category.questions) {
    if (q.answerType === 'boolean' && answers[q.id] === true) {
      if (typeof q.pointValue === 'number') {
        total += q.pointValue;
      } else if (q.needsManualPoints) {
        total += toNumeric(answers[`${q.id}__manual`] ?? 0);
      }
    }

    if (q.answerType === 'select') {
      const selectedOption = resolveSelectedOption(q, answers);
      if (typeof selectedOption?.points === 'number') {
        total += selectedOption.points;
      }
    }

    if (q.id.endsWith('_points')) {
      total += toNumeric(answers[q.id] ?? 0);
    }
  }
  return total;
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
