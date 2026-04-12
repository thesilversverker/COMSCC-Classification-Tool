import { computeWeightSheetPoints } from './weight-worksheet-points';

const integraLikeCatalog = {
  factoryRatedHp: 140,
  factoryRatedTorqueLbFt: 126,
  performanceAdjustment: -5,
  showroomAssessment: 24.62746305418719
};

describe('computeWeightSheetPoints', () => {
  it('returns 0 without positive competition weight', () => {
    expect(computeWeightSheetPoints(0, integraLikeCatalog)).toBe(0);
    expect(computeWeightSheetPoints(-1, integraLikeCatalog)).toBe(0);
  });

  it('returns 0 when catalog scalars are missing', () => {
    expect(computeWeightSheetPoints(2623, null)).toBe(0);
    expect(
      computeWeightSheetPoints(2623, {
        factoryRatedHp: null,
        factoryRatedTorqueLbFt: 126,
        performanceAdjustment: -5,
        showroomAssessment: 24.62746305418719
      })
    ).toBe(0);
  });

  it('is 0 at showroom curb weight (bracket cancels for derived showroom rows)', () => {
    expect(computeWeightSheetPoints(2623, integraLikeCatalog)).toBe(0);
  });

  it('changes when competition weight differs from showroom curb weight', () => {
    const lighter = computeWeightSheetPoints(2500, integraLikeCatalog);
    const heavier = computeWeightSheetPoints(2800, integraLikeCatalog);
    expect(lighter).toBeGreaterThan(0);
    expect(heavier).toBeLessThan(0);
  });
});
