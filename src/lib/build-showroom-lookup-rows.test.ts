import { describe, expect, it } from 'vitest';
import { flattenOpenDb, pickComsccRow } from '../../scripts/build-showroom-lookup-rows.mjs';

const comsccRows = [
  {
    vehicleMake: 'Acura',
    vehicleModel: 'Integra',
    vehicleTrim: null,
    vehicleYearBegin: 1990,
    vehicleYearEnd: 1993,
    showroomBaseWeightLbs: 2623,
    factoryRatedHp: 140,
    factoryRatedTorqueLbFt: 126,
    suspIndex: 50
  },
  {
    vehicleMake: 'Acura',
    vehicleModel: 'Integra',
    vehicleTrim: 'Type-R',
    vehicleYearBegin: 1995,
    vehicleYearEnd: 2001,
    showroomBaseWeightLbs: 2639,
    factoryRatedHp: 195,
    factoryRatedTorqueLbFt: 130,
    suspIndex: 70
  }
];

describe('pickComsccRow', () => {
  it('applies null-trim catalog only to base rows, not styled trims', () => {
    const base = pickComsccRow('Acura', 'Integra', 1993, comsccRows, null);
    expect(base?.showroomBaseWeightLbs).toBe(2623);
    expect(pickComsccRow('Acura', 'Integra', 1993, comsccRows, 'Type-R')).toBeNull();
  });

  it('applies trim-specific catalog only when trim matches (slug-equivalent)', () => {
    const tr = pickComsccRow('Acura', 'Integra', 1999, comsccRows, 'Type-R');
    expect(tr?.showroomBaseWeightLbs).toBe(2639);
    expect(pickComsccRow('Acura', 'Integra', 1999, comsccRows, null)?.showroomBaseWeightLbs).not.toBe(
      2639
    );
    expect(pickComsccRow('Acura', 'Integra', 1999, comsccRows, 'GS-R')).toBeNull();
  });

  it('prefers the narrowest year span among trim-matching candidates', () => {
    const rows = [
      ...comsccRows,
      {
        vehicleMake: 'Acura',
        vehicleModel: 'Integra',
        vehicleTrim: 'Type-R',
        vehicleYearBegin: 1997,
        vehicleYearEnd: 1997,
        showroomBaseWeightLbs: 2700,
        factoryRatedHp: 195,
        factoryRatedTorqueLbFt: 130,
        suspIndex: 70
      }
    ];
    const hit = pickComsccRow('Acura', 'Integra', 1997, rows, 'Type-R');
    expect(hit?.showroomBaseWeightLbs).toBe(2700);
  });
});

describe('flattenOpenDb', () => {
  it('keeps base-year rows for years not listed on any style', () => {
    const flat = flattenOpenDb([
      {
        make_slug: 'acura',
        make_name: 'Acura',
        models: {
          Integra: {
            model_name: 'Integra',
            years: [1994, 1995, 1996],
            model_styles: {
              'Type-R': { years: [1995, 1996] }
            }
          }
        }
      }
    ]);
    const keys = flat.map((r) => `${r.year}:${r.trimKey ?? 'base'}`).sort();
    expect(keys).toEqual(['1994:base', '1995:Type-R', '1996:Type-R']);
  });
});
