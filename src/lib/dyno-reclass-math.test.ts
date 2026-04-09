import {
  computeDynoPointsAboveBaseAssessment,
  dynoPointsAboveBaseFromSession,
  scaledPowerFromDynoAnswers
} from './dyno-reclass-math';

describe('dyno-reclass-math', () => {
  it('floors points at −2', () => {
    const v = computeDynoPointsAboveBaseAssessment({
      showroomBaseWeightLbs: 3000,
      scaledPower: 100,
      factoryRatedHp: 200,
      factoryRatedTorqueLbFt: 300
    });
    expect(v).toBe(-2);
  });

  it('computes workbook-style raw when above floor', () => {
    const v = computeDynoPointsAboveBaseAssessment({
      showroomBaseWeightLbs: 1000,
      scaledPower: 500,
      factoryRatedHp: 50,
      factoryRatedTorqueLbFt: 50
    });
    // (−4.25 * 1000/500) + 112 − (50*2/3 + 50/3) = −8.5 + 112 − 50 = 53.5
    expect(v).toBeCloseTo(53.5, 5);
  });

  it('returns null when scaled power or catalog fields are missing', () => {
    expect(
      dynoPointsAboveBaseFromSession({
        answers: {},
        showroomBaseWeightLbs: 1000,
        factoryRatedHp: 50,
        factoryRatedTorqueLbFt: 50
      })
    ).toBeNull();
  });

  it('derives scaled power from dyno answers (2WD 13% loss)', () => {
    const scaled = scaledPowerFromDynoAnswers({
      dyno_peak_horsepower: 200,
      dyno_peak_torque_lbft: 200,
      dyno_drivetrain_type: '2wd'
    });
    // (200*2/3 + 200/3) / 0.87 = 200/0.87
    expect(scaled).toBeCloseTo(200 / 0.87, 5);
  });
});
