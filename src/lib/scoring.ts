// Logical component: category point totals from session answers (shared by nav and main view).
import type { RuleAnswer, RuleAnswersByQuestionId, RuleCategory, RuleQuestion } from '$types/rules';

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

export function computeCategoryPoints(category: RuleCategory, answers: RuleAnswersByQuestionId): number {
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
