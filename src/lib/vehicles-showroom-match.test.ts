import type { RuleAnswersByQuestionId } from '$types/rules';
import { findShowroomCatalogMatch, type ShowroomLookupRow } from './vehicles-showroom-match';

const sampleRows: ShowroomLookupRow[] = [
  {
    makeNorm: 'acura',
    modelNorm: 'integra',
    startYear: 1993,
    endYear: 1993,
    showroomAssessment: 24.5,
    showroomBaseWeightLbs: 2623,
    baseClassification: 'T5',
    catalogId: 'a'
  },
  {
    makeNorm: 'acura',
    modelNorm: 'integra',
    startYear: 1990,
    endYear: 1999,
    showroomAssessment: 99,
    showroomBaseWeightLbs: 2600,
    baseClassification: 'T4',
    catalogId: 'b'
  }
];

describe('findShowroomCatalogMatch', () => {
  it('returns null without full selection', () => {
    expect(findShowroomCatalogMatch({} as RuleAnswersByQuestionId, sampleRows)).toBeNull();
  });

  it('prefers the narrowest year span', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Acura',
      vehicles_model_label: 'Integra',
      vehicles_year: '1993'
    };
    const hit = findShowroomCatalogMatch(answers, sampleRows);
    expect(hit?.catalogId).toBe('a');
    expect(hit?.showroomAssessment).toBe(24.5);
  });
});
