/**
 * Logical component: frozen regression inputs for `findShowroomCatalogMatch` tied to the
 * vehicle-catalog-rejects.csv alias buckets (trim slug normalization, duplicate-row tie-break).
 *
 * Rows mirror what `npm run data:compose-vehicles` emits (makeNorm/modelNorm/year/trimKey/catalogId).
 * If projection or compose changes matching semantics, this test fails first.
 */

import type { RuleAnswersByQuestionId } from '$types/rules';
import {
  findShowroomCatalogMatch,
  type ShowroomLookupRow
} from '$lib/vehicles-showroom-match';

/** Frozen showroom rows — catalogIds are stable compose-time identifiers. */
const frozenRows: ShowroomLookupRow[] = [
  {
    makeNorm: 'bmw',
    modelNorm: 'm3',
    year: 1988,
    trimKey: 'E30 M3',
    showroomAssessment: 50,
    scaledWeightPerPower: 46,
    performanceAdjustment: 5,
    showroomBaseWeightLbs: 2866,
    factoryRatedHp: 192,
    factoryRatedTorqueLbFt: 170,
    baseClassification: 'T4',
    catalogId: 'ov_bmw_m3_1988_e30_m3',
    comsccEnriched: true
  },
  {
    makeNorm: 'mazda',
    modelNorm: 'mazda3',
    year: 2012,
    trimKey: null,
    showroomAssessment: 10,
    scaledWeightPerPower: 27,
    performanceAdjustment: -2.5,
    showroomBaseWeightLbs: 2866,
    factoryRatedHp: 148,
    factoryRatedTorqueLbFt: 135,
    baseClassification: 'T5',
    catalogId: 'ov_mazda_mazda3_2012_base',
    comsccEnriched: true
  }
];

describe('findShowroomCatalogMatch catalog snapshot (rejects buckets)', () => {
  it('resolves BMW chassis-as-model + named trim (slug-equivalent)', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'BMW',
      vehicles_model_label: 'M3',
      vehicles_year: '1988',
      vehicles_trim_key: 'E30 M3'
    };
    const hit = findShowroomCatalogMatch(answers, frozenRows, []);
    expect(hit?.catalogId).toBe('ov_bmw_m3_1988_e30_m3');
    expect(hit?.comsccEnriched).toBe(true);
  });

  it('tie-break prefers comsccEnriched when duplicate (make, model, year, trim) rows exist', () => {
    const dupRows: ShowroomLookupRow[] = [
      {
        makeNorm: 'bmw',
        modelNorm: 'm3',
        year: 1988,
        trimKey: 'E30 M3',
        showroomAssessment: 40,
        scaledWeightPerPower: 40,
        performanceAdjustment: 0,
        showroomBaseWeightLbs: 2800,
        factoryRatedHp: 180,
        factoryRatedTorqueLbFt: 170,
        baseClassification: 'T5',
        catalogId: 'dup-light',
        comsccEnriched: false
      },
      {
        makeNorm: 'bmw',
        modelNorm: 'm3',
        year: 1988,
        trimKey: 'E30 M3',
        showroomAssessment: 50,
        scaledWeightPerPower: 46,
        performanceAdjustment: 5,
        showroomBaseWeightLbs: 2866,
        factoryRatedHp: 192,
        factoryRatedTorqueLbFt: 170,
        baseClassification: 'T4',
        catalogId: 'dup-heavy',
        comsccEnriched: true
      }
    ];
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'BMW',
      vehicles_model_label: 'M3',
      vehicles_year: '1988',
      vehicles_trim_key: 'E30 M3'
    };
    const hit = findShowroomCatalogMatch(answers, dupRows, []);
    expect(hit?.catalogId).toBe('dup-heavy');
  });

  it('matches Mazda3 CSV alias bucket (model label Mazda3 vs Mazda 3)', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Mazda',
      vehicles_model_label: 'Mazda3',
      vehicles_year: '2012',
      vehicles_trim_key: null
    };
    const hit = findShowroomCatalogMatch(answers, frozenRows, []);
    expect(hit?.catalogId).toBe('ov_mazda_mazda3_2012_base');
  });
});
