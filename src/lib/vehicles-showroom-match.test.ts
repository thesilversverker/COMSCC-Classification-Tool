import type { RuleAnswersByQuestionId } from '$types/rules';
import { COMSCC_TRIM_BASE_SENTINEL } from './comscc-catalog-trims';
import {
  findShowroomCatalogMatch,
  isVehicleSelectionComplete,
  type ShowroomLookupRow
} from './vehicles-showroom-match';

const sampleRows: ShowroomLookupRow[] = [
  {
    makeNorm: 'acura',
    modelNorm: 'integra',
    year: 1993,
    trimKey: null,
    showroomAssessment: 24.5,
    scaledWeightPerPower: 29.6,
    performanceAdjustment: -10,
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
    scaledWeightPerPower: 28,
    performanceAdjustment: -8,
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
    const hit = findShowroomCatalogMatch(answers, sampleRows, []);
    expect(hit?.catalogId).toBe('ov_acura_integra_1993_gs_r');
  });

  it('matches trim by slug-equivalent string (session vs catalog row)', () => {
    const audiRows: ShowroomLookupRow[] = [
      {
        makeNorm: 'audi',
        modelNorm: 'a4',
        year: 2007,
        trimKey: null,
        showroomAssessment: 0,
        scaledWeightPerPower: 0,
        performanceAdjustment: 0,
        showroomBaseWeightLbs: 1500,
        factoryRatedHp: 500,
        factoryRatedTorqueLbFt: 500,
        baseClassification: null,
        catalogId: 'ov_audi_a4_2007',
        comsccEnriched: false
      },
      {
        makeNorm: 'audi',
        modelNorm: 'a4',
        year: 2007,
        trimKey: '2.0T Quattro',
        showroomAssessment: 24,
        scaledWeightPerPower: 25,
        performanceAdjustment: 0,
        showroomBaseWeightLbs: 3549,
        factoryRatedHp: 200,
        factoryRatedTorqueLbFt: 207,
        baseClassification: 'T5',
        catalogId: 'ov_audi_a4_2007_2_0t_quattro',
        comsccEnriched: true
      }
    ];
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Audi',
      vehicles_model_label: 'A4',
      vehicles_year: '2007',
      // Logical component: UI or saved session may differ slightly from composed `trimKey` while slugifying the same.
      vehicles_trim_key: '2.0t  quattro'
    };
    const hit = findShowroomCatalogMatch(answers, audiRows, []);
    expect(hit?.catalogId).toBe('ov_audi_a4_2007_2_0t_quattro');
    expect(hit?.showroomBaseWeightLbs).toBe(3549);
  });

  it('when multiple rows slug-match trim, prefers COMSCC-enriched then heavier weight', () => {
    const dupSlugRows: ShowroomLookupRow[] = [
      {
        makeNorm: 'audi',
        modelNorm: 'a4',
        year: 2007,
        trimKey: '2.0T-Quattro',
        showroomAssessment: 0,
        scaledWeightPerPower: 0,
        performanceAdjustment: 0,
        showroomBaseWeightLbs: 1500,
        factoryRatedHp: 500,
        factoryRatedTorqueLbFt: 500,
        baseClassification: null,
        catalogId: 'stale',
        comsccEnriched: false
      },
      {
        makeNorm: 'audi',
        modelNorm: 'a4',
        year: 2007,
        trimKey: '2.0T Quattro',
        showroomAssessment: 24,
        scaledWeightPerPower: 25,
        performanceAdjustment: 0,
        showroomBaseWeightLbs: 3549,
        factoryRatedHp: 200,
        factoryRatedTorqueLbFt: 207,
        baseClassification: 'T5',
        catalogId: 'good',
        comsccEnriched: true
      }
    ];
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Audi',
      vehicles_model_label: 'A4',
      vehicles_year: '2007',
      vehicles_trim_key: '2.0T Quattro'
    };
    const hit = findShowroomCatalogMatch(answers, dupSlugRows, []);
    expect(hit?.catalogId).toBe('good');
  });

  it('maps Base sentinel to null-trim lookup row', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Acura',
      vehicles_model_label: 'Integra',
      vehicles_year: '1993',
      vehicles_trim_key: COMSCC_TRIM_BASE_SENTINEL
    };
    const hit = findShowroomCatalogMatch(answers, sampleRows, [
      {
        vehicleMake: 'Acura',
        vehicleModel: 'Integra',
        vehicleTrim: null,
        vehicleYearBegin: 1990,
        vehicleYearEnd: 1995
      },
      {
        vehicleMake: 'Acura',
        vehicleModel: 'Integra',
        vehicleTrim: 'GS-R',
        vehicleYearBegin: 1993,
        vehicleYearEnd: 1993
      }
    ]);
    expect(hit?.catalogId).toBe('ov_acura_integra_1993_base');
  });

  it('returns null until trim is chosen when COMSCC catalog requires a trim step', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_label: 'Acura',
      vehicles_model_label: 'Integra',
      vehicles_year: '1999',
      vehicles_trim_key: ''
    };
    const catalog = [
      {
        vehicleMake: 'Acura',
        vehicleModel: 'Integra',
        vehicleTrim: 'Type-R',
        vehicleYearBegin: 1995,
        vehicleYearEnd: 2001
      }
    ];
    expect(findShowroomCatalogMatch(answers, sampleRows, catalog)).toBeNull();
  });
});

describe('isVehicleSelectionComplete', () => {
  it('returns false without make slug, model key, or four-digit year', () => {
    expect(isVehicleSelectionComplete({} as RuleAnswersByQuestionId, [])).toBe(false);
    expect(
      isVehicleSelectionComplete(
        {
          vehicles_make_slug: 'acura',
          vehicles_make_label: 'Acura',
          vehicles_model_key: 'integra',
          vehicles_model_label: 'Integra',
          vehicles_year: '199'
        } as RuleAnswersByQuestionId,
        []
      )
    ).toBe(false);
  });

  it('returns true when trim step not required', () => {
    expect(
      isVehicleSelectionComplete(
        {
          vehicles_make_slug: 'acura',
          vehicles_make_label: 'Acura',
          vehicles_model_key: 'integra',
          vehicles_model_label: 'Integra',
          vehicles_year: '1993'
        } as RuleAnswersByQuestionId,
        []
      )
    ).toBe(true);
  });

  it('returns false until trim is chosen when catalog lists trims for that year', () => {
    const catalog = [
      {
        vehicleMake: 'Acura',
        vehicleModel: 'Integra',
        vehicleTrim: 'Type-R',
        vehicleYearBegin: 1995,
        vehicleYearEnd: 2001
      }
    ];
    expect(
      isVehicleSelectionComplete(
        {
          vehicles_make_slug: 'acura',
          vehicles_make_label: 'Acura',
          vehicles_model_key: 'integra',
          vehicles_model_label: 'Integra',
          vehicles_year: '1999',
          vehicles_trim_key: ''
        } as RuleAnswersByQuestionId,
        catalog
      )
    ).toBe(false);
    expect(
      isVehicleSelectionComplete(
        {
          vehicles_make_slug: 'acura',
          vehicles_make_label: 'Acura',
          vehicles_model_key: 'integra',
          vehicles_model_label: 'Integra',
          vehicles_year: '1999',
          vehicles_trim_key: 'Type-R'
        } as RuleAnswersByQuestionId,
        catalog
      )
    ).toBe(true);
  });
});
