import showroomLookup from '$data/vehicle-showroom-lookup.json';
import comsccCatalogJson from '../../rules-source/vehicles-comscc-catalog.json';
import type { ComsccCatalogSeedRow } from '$lib/comscc-catalog-trims';
import { dynoPointsAboveBaseFromSession } from './dyno-reclass-math';
import { computeCategoryPoints, sumCategoryPoints } from './scoring';
import {
  findShowroomCatalogMatch,
  type ShowroomLookupRow
} from './vehicles-showroom-match';
import type { RuleCategory, RuleQuestion } from '$types/rules';

// Logical component: mirror scoring.ts showroom lookup wiring so expectations track composed data.
const SHOWROOM_LOOKUP_ROWS = (showroomLookup as { rows: ShowroomLookupRow[] }).rows;
const COMSCC_VEHICLE_CATALOG: ComsccCatalogSeedRow[] = Array.isArray(
  (comsccCatalogJson as { vehicleCatalog?: unknown }).vehicleCatalog
)
  ? (comsccCatalogJson as { vehicleCatalog: ComsccCatalogSeedRow[] }).vehicleCatalog
  : [];

describe('scoring', () => {
  it('sums category point map values', () => {
    expect(sumCategoryPoints({ a: 1.5, b: 2, c: 0 })).toBe(3.5);
    expect(sumCategoryPoints({})).toBe(0);
  });
});

// Logical component: tires category adds (avgWidth − specWidth) × 0.05 to model points (tier from converged grand).
const tiresModelFixture: RuleQuestion = {
  id: 'tires_model',
  prompt: 'Tire',
  subcategory: 'Tire catalog',
  answerType: 'select',
  options: [{ id: 'test_tire', label: 'Test tire', points: 2 }]
};
const tiresWidthFixture: RuleQuestion = {
  id: 'tires_width_mm',
  prompt: 'Primary width',
  subcategory: 'Sizing',
  answerType: 'number'
};
const tiresCategoryFixture: RuleCategory = {
  id: 'tires',
  label: 'Tires',
  questions: [tiresModelFixture, tiresWidthFixture]
};
const emptyExteriorCategoryFixture: RuleCategory = {
  id: 'exterior',
  label: 'Exterior',
  questions: []
};

describe('computeCategoryPoints tires width line', () => {
  const cats = [emptyExteriorCategoryFixture, tiresCategoryFixture];

  it('adds width delta to model points using spec tier (T5 at low grand total)', () => {
    const answers = {
      tires_model: 'test_tire',
      tires_width_mm: 285
    };
    // Model 2 + (285 − 205) × 0.05 = 6
    expect(computeCategoryPoints(tiresCategoryFixture, answers, cats)).toBeCloseTo(6, 10);
  });

  it('returns model points only when no tire width entered', () => {
    expect(
      computeCategoryPoints(tiresCategoryFixture, { tires_model: 'test_tire' }, cats)
    ).toBe(2);
  });
});

// Logical component: engine category uses dyno vs showroom as sole total when dyno path is active.
const dynoToggleQuestion: RuleQuestion = {
  id: 'dyno_reclass_selected',
  prompt: 'Dyno Reclass selected',
  subcategory: 'Dyno reclass',
  answerType: 'select',
  options: [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' }
  ]
};

const fixedEngineMod: RuleQuestion = {
  id: 'fake_ecu',
  prompt: 'Test ECU mod',
  subcategory: 'Other',
  answerType: 'boolean',
  pointValue: 7,
  needsManualPoints: false
};

const manualEngineLine: RuleQuestion = {
  id: 'fake_dyno_sheet_line',
  prompt: 'Manual-points line',
  subcategory: 'Other',
  answerType: 'number',
  pointValue: null,
  needsManualPoints: true
};

const engineCategoryFixture: RuleCategory = {
  id: 'engine',
  label: 'Engine',
  questions: [dynoToggleQuestion, fixedEngineMod, manualEngineLine]
};

describe('computeCategoryPoints engine', () => {
  // Logical component: pick a year still present after catalog-scoped open-vehicle compose (see vehicle-showroom-lookup.json).
  const vehicleForShowroomRow = {
    vehicles_make_label: 'ACURA',
    vehicles_model_label: 'INTEGRA',
    vehicles_year: '2024'
  };

  it('uses only dyno assessment when Dyno Reclass is yes (checkbox mods excluded)', () => {
    const answers = {
      ...vehicleForShowroomRow,
      dyno_reclass_selected: 'yes',
      dyno_peak_horsepower: 200,
      dyno_peak_torque_lbft: 200,
      dyno_drivetrain_type: '2wd',
      fake_ecu: true
    };
    // Logical component: expected dyno total uses the same catalog row as computeCategoryPoints (scoring.ts).
    const match = findShowroomCatalogMatch(answers, SHOWROOM_LOOKUP_ROWS, COMSCC_VEHICLE_CATALOG);
    expect(match).not.toBeNull();
    const expected = dynoPointsAboveBaseFromSession({
      answers,
      showroomBaseWeightLbs: match!.showroomBaseWeightLbs ?? null,
      factoryRatedHp: match!.factoryRatedHp ?? null,
      factoryRatedTorqueLbFt: match!.factoryRatedTorqueLbFt ?? null,
      performanceAdjustment: match!.performanceAdjustment ?? null,
      showroomAssessment: match!.showroomAssessment ?? null
    });
    expect(expected).not.toBeNull();
    expect(computeCategoryPoints(engineCategoryFixture, answers)).toBe(expected);
  });

  it('sums sheet checkbox mods when Dyno Reclass is no and no manual dyno sheet line', () => {
    expect(
      computeCategoryPoints(engineCategoryFixture, {
        dyno_reclass_selected: 'no',
        fake_ecu: true
      })
    ).toBe(7);
  });

  it('uses dyno-only path when a manual-points engine line is answered (checkbox mods excluded)', () => {
    expect(
      computeCategoryPoints(engineCategoryFixture, {
        dyno_reclass_selected: 'no',
        fake_dyno_sheet_line: 55
      })
    ).toBe(0);
  });

  it('uses dyno-only path when a dynoReclassTrigger checkbox is checked (checkbox mods not summed)', () => {
    const dynoCheckboxOnly: RuleCategory = {
      id: 'engine',
      label: 'Engine',
      questions: [
        dynoToggleQuestion,
        fixedEngineMod,
        {
          id: 'fake_big_turbo',
          prompt: 'Big turbo',
          subcategory: 'Forced induction',
          answerType: 'boolean',
          pointValue: null,
          needsManualPoints: false,
          dynoReclassTrigger: true
        }
      ]
    };
    expect(
      computeCategoryPoints(dynoCheckboxOnly, {
        dyno_reclass_selected: 'no',
        fake_ecu: true,
        fake_big_turbo: true
      })
    ).toBe(0);
  });
});

describe('computeCategoryPoints exterior', () => {
  const activeAeroQuestion: RuleQuestion = {
    id: 'exterior_active_aero_test',
    prompt: 'Active aero test',
    subcategory: 'Active aero & graphics',
    answerType: 'boolean',
    pointValue: 4,
    needsManualPoints: false,
    pointQuantityMultiplier: true
  };

  const exteriorFixture: RuleCategory = {
    id: 'exterior',
    label: 'Exterior',
    questions: [activeAeroQuestion]
  };

  it('multiplies pointValue by piece count when checked (default 1 if quantity unset)', () => {
    expect(
      computeCategoryPoints(exteriorFixture, {
        exterior_active_aero_test: true
      })
    ).toBe(4);
    expect(
      computeCategoryPoints(exteriorFixture, {
        exterior_active_aero_test: true,
        exterior_active_aero_test__quantity: 3
      })
    ).toBe(12);
    expect(
      computeCategoryPoints(exteriorFixture, {
        exterior_active_aero_test: true,
        exterior_active_aero_test__quantity: 0
      })
    ).toBe(0);
  });
});
