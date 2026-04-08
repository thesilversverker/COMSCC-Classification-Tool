import {
  modificationPointsRangeLabel,
  specTireWidthMmForTier,
  touringTierFromModificationPoints
} from './touring-tiers';

describe('touring tiers', () => {
  it('maps modification totals to T5 through T1', () => {
    expect(touringTierFromModificationPoints(0)).toBe('T5');
    expect(touringTierFromModificationPoints(44.9)).toBe('T5');
    expect(touringTierFromModificationPoints(45)).toBe('T4');
    expect(touringTierFromModificationPoints(59.9)).toBe('T4');
    expect(touringTierFromModificationPoints(60)).toBe('T3');
    expect(touringTierFromModificationPoints(74.9)).toBe('T3');
    expect(touringTierFromModificationPoints(75)).toBe('T2');
    expect(touringTierFromModificationPoints(94.9)).toBe('T2');
    expect(touringTierFromModificationPoints(95)).toBe('T1');
    expect(touringTierFromModificationPoints(120)).toBe('T1');
    expect(touringTierFromModificationPoints(200)).toBe('T1');
  });

  it('exposes spec tire width per tier', () => {
    expect(specTireWidthMmForTier('T5')).toBe(185);
    expect(specTireWidthMmForTier('T1')).toBe(315);
  });

  it('formats range labels for the tier strip', () => {
    expect(modificationPointsRangeLabel('T5')).toBe('0 – 44.9');
    expect(modificationPointsRangeLabel('T4')).toBe('45 – 59.9');
    expect(modificationPointsRangeLabel('T3')).toBe('60 – 74.9');
    expect(modificationPointsRangeLabel('T2')).toBe('75 – 94.9');
    expect(modificationPointsRangeLabel('T1')).toBe('95 – 120');
  });
});
