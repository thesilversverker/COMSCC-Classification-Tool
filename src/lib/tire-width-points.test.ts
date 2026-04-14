import { averageTireWidthMmFromAnswers, tireWidthDeltaPoints, tireWidthLinePointsForGrandTotal } from './tire-width-points';

describe('tire-width-points', () => {
  it('computes delta points from average and spec', () => {
    expect(tireWidthDeltaPoints(285, 205)).toBeCloseTo(4, 10);
    expect(tireWidthDeltaPoints(205, 205)).toBe(0);
  });

  it('averages primary and stagger when both set', () => {
    expect(
      averageTireWidthMmFromAnswers({
        tires_width_mm: 255,
        tires_width_stagger_mm: 275
      })
    ).toBe(265);
  });

  it('returns null when no widths entered', () => {
    expect(averageTireWidthMmFromAnswers({})).toBeNull();
  });

  it('maps width line from grand total via spec tier', () => {
    expect(tireWidthLinePointsForGrandTotal({ tires_width_mm: 285 }, 0)).toBeCloseTo(4, 10);
    expect(tireWidthLinePointsForGrandTotal({ tires_width_mm: 205 }, 0)).toBe(0);
  });
});
