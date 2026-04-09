import { describe, expect, it } from 'vitest';
import { computeComsccDerivedFields } from '../../scripts/comscc-derived-fields.mjs';

describe('computeComsccDerivedFields', () => {
  it('computes workbook-style chain from template scalars', () => {
    const d = computeComsccDerivedFields({
      showroomBaseWeightLbs: 3000,
      factoryRatedHp: 250,
      factoryRatedTorqueLbFt: 210,
      suspIndex: 80
    });
    expect(d.powerBlend).toBeCloseTo((2 / 3) * 250 + (1 / 3) * 210, 5);
    expect(d.weightPerPower).toBeCloseTo(3000 / d.powerBlend!, 5);
    expect(d.scaledWeightPerPower).toBeCloseTo(112 - 4.25 * d.weightPerPower!, 5);
    expect(d.performanceAdjustment).toBeCloseTo(((80 - 70) / 3) * 1.5, 5);
    expect(d.showroomAssessment).toBeCloseTo(d.scaledWeightPerPower! + d.performanceAdjustment!, 5);
  });

  it('returns null derived fields when weight or power inputs missing', () => {
    const d = computeComsccDerivedFields({ suspIndex: 80 });
    expect(d.showroomAssessment).toBeNull();
  });
});
