import type { RuleAnswersByQuestionId } from '$types/rules';
import { findShowroomCatalogMatch, type ShowroomLookupRow } from './vehicles-showroom-match';

const sampleRows: ShowroomLookupRow[] = [
  {
    makeNorm: 'acura',
    modelNorm: 'integra',
    year: 1993,
    trimKey: null,
    showroomAssessment: 24.5,
    showroomBaseWeightLbs: 2623,
    factoryRatedHp: 142,
    factoryRatedTorqueLbFt: 136,
    baseClassification: 'T5',
    catalogId: 'ov_acura_integra_1993_base'
  },
  {
    makeNorm: 'acura',
    modelNorm: 'integra',
    year: 1993,
    trimKey: 'GS-R',
    showroomAssessment: 30,
    showroomBaseWeightLbs: 2600,
    factoryRatedHp: 170,
    factoryRatedTorqueLbFt: 128,
    baseClassification: 'T4',
    catalogId: 'ov_acura_integra_1993_gs_r'
  }
];

describe('findShowroomCatalogMatch', () => {
  it('returns null without full selection', () => {
    expect(findShowroomCatalogMatch({} as RuleAnswersByQuestionId, sampleRows)).toBeNull();
  });

  it('matches exact year and null trim', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Acura',
      vehicles_model_label: 'Integra',
      vehicles_year: '1993',
      vehicles_trim_key: null
    };
    const hit = findShowroomCatalogMatch(answers, sampleRows);
    expect(hit?.catalogId).toBe('ov_acura_integra_1993_base');
    expect(hit?.showroomAssessment).toBe(24.5);
  });

  it('disambiguates with trim key when present', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Acura',
      vehicles_model_label: 'Integra',
      vehicles_year: '1993',
      vehicles_trim_key: 'GS-R'
    };
    const hit = findShowroomCatalogMatch(answers, sampleRows);
    expect(hit?.catalogId).toBe('ov_acura_integra_1993_gs_r');
  });
});
