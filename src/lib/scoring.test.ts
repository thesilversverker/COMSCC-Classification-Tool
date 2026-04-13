import { dynoPointsAboveBaseFromSession } from './dyno-reclass-math';
import { computeCategoryPoints, sumCategoryPoints } from './scoring';
import type { RuleCategory, RuleQuestion } from '$types/rules';

describe('scoring', () => {
  it('sums category point map values', () => {
    expect(sumCategoryPoints({ a: 1.5, b: 2, c: 0 })).toBe(3.5);
    expect(sumCategoryPoints({})).toBe(0);
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
  const vehicleForShowroomRow = {
    vehicles_make_label: 'ACURA',
    vehicles_model_label: 'CL',
    vehicles_year: '1987'
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
    const expected = dynoPointsAboveBaseFromSession({
      answers,
      showroomBaseWeightLbs: 8000,
      factoryRatedHp: 500,
      factoryRatedTorqueLbFt: 500
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
});
