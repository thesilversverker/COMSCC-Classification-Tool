import { sumCategoryPoints } from './scoring';

describe('scoring', () => {
  it('sums category point map values', () => {
    expect(sumCategoryPoints({ a: 1.5, b: 2, c: 0 })).toBe(3.5);
    expect(sumCategoryPoints({})).toBe(0);
  });
});
