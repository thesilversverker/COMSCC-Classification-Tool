import {
  modificationPointsRangeLabel,
  specTireWidthMmForTier,
  touringTierFromModificationPoints
} from './touring-tiers';

describe('touring tiers', () => {
  it('maps modification totals to T5 through T1', () => {
    expect(touringTierFromModificationPoints(0)).toBe('T5');
    expect(touringTierFromModificationPoints(21.9)).toBe('T5');
    expect(touringTierFromModificationPoints(22)).toBe('T4');
    expect(touringTierFromModificationPoints(43.9)).toBe('T4');
    expect(touringTierFromModificationPoints(44)).toBe('T3');
    expect(touringTierFromModificationPoints(65.9)).toBe('T3');
    expect(touringTierFromModificationPoints(66)).toBe('T2');
    expect(touringTierFromModificationPoints(87.9)).toBe('T2');
    expect(touringTierFromModificationPoints(88)).toBe('T1');
    expect(touringTierFromModificationPoints(200)).toBe('T1');
  });

  it('exposes spec tire width per tier', () => {
    expect(specTireWidthMmForTier('T5')).toBe(185);
    expect(specTireWidthMmForTier('T1')).toBe(315);
  });

  it('formats range labels for the tier strip', () => {
    expect(modificationPointsRangeLabel('T5')).toContain('0');
    expect(modificationPointsRangeLabel('T1')).toContain('88');
  });
});
