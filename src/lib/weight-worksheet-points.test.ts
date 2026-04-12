import { computeWeightSheetPoints } from './weight-worksheet-points';

describe('computeWeightSheetPoints', () => {
  it('returns 0 without positive competition weight', () => {
    expect(computeWeightSheetPoints(0, { scaledWeightPerPower: 30, performanceAdjustment: -5, showroomAssessment: 20 })).toBe(0);
    expect(computeWeightSheetPoints(-1, { scaledWeightPerPower: 30, performanceAdjustment: -5, showroomAssessment: 20 })).toBe(0);
  });

  it('returns 0 when catalog scalars are missing', () => {
    expect(computeWeightSheetPoints(2623, null)).toBe(0);
    expect(computeWeightSheetPoints(2623, { scaledWeightPerPower: null, performanceAdjustment: -5, showroomAssessment: 20 })).toBe(0);
  });

  it('applies sheet-style division chain', () => {
    // bracket = 30 + (-5) - 20 = 5; denom = 500; 2623/500/100 = 0.05246
    expect(computeWeightSheetPoints(2623, { scaledWeightPerPower: 30, performanceAdjustment: -5, showroomAssessment: 20 })).toBeCloseTo(0.05246, 5);
  });
});
