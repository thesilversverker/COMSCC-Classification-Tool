import {
  computeDynoPointsAboveBaseAssessment,
  computeScaledPowerWheelHp,
  dynoLossFraction,
  dynoPointsAboveBaseFromSession,
  explainDynoPointsAboveBaseFromSession,
  formatDynoPointsAboveBaseExplanation,
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

  it('computes Excel-style raw when above floor (subtract Car_Scaled_Power, not FB)', () => {
    const v = computeDynoPointsAboveBaseAssessment({
      showroomBaseWeightLbs: 1000,
      scaledPower: 500,
      factoryRatedHp: 50,
      factoryRatedTorqueLbFt: 50
    });
    // CSP = 112 − 4.25×(1000/50) = 27; raw = (−4.25×1000/500)+112 − 27 = 76.5
    expect(v).toBeCloseTo(76.5, 5);
  });

  it('matches workbook Audi A4 2.0T Quattro (DSC + PA − SA, INT, no floor)', () => {
    const sp = computeScaledPowerWheelHp(500, 255, dynoLossFraction('awd'));
    expect(sp).toBeCloseTo(498, 0);
    const pts = computeDynoPointsAboveBaseAssessment({
      showroomBaseWeightLbs: 3549,
      scaledPower: sp!,
      factoryRatedHp: 200,
      factoryRatedTorqueLbFt: 207,
      performanceAdjustment: 0,
      showroomAssessment: 37.453459637561764
    });
    expect(pts).toBeCloseTo(44.25, 5);
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

  it('explainDynoPointsAboveBaseFromSession matches compute path and flags floor when truncated < −2', () => {
    const answers = {
      dyno_peak_horsepower: 10,
      dyno_peak_torque_lbft: 10,
      dyno_drivetrain_type: '2wd' as const
    };
    const ex = explainDynoPointsAboveBaseFromSession({
      answers,
      showroomBaseWeightLbs: 3000,
      factoryRatedHp: 200,
      factoryRatedTorqueLbFt: 300
    });
    expect(ex).not.toBeNull();
    const pts = dynoPointsAboveBaseFromSession({
      answers,
      showroomBaseWeightLbs: 3000,
      factoryRatedHp: 200,
      factoryRatedTorqueLbFt: 300
    });
    expect(ex!.result).toBe(pts);
    expect(ex!.clampedToMinusTwo).toBe(true);
    expect(formatDynoPointsAboveBaseExplanation(ex!)).toMatch(/truncated = INT/);
  });
});
