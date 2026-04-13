import { describe, expect, it } from 'vitest';
import {
  comsccCatalogRowsForYear,
  comsccTrimChoicesForYear,
  COMSCC_TRIM_BASE_SENTINEL
} from './comscc-catalog-trims';

const sampleCatalog = [
  {
    vehicleMake: 'Acura',
    vehicleModel: 'Integra',
    vehicleTrim: null,
    vehicleYearBegin: 1990,
    vehicleYearEnd: 1993
  },
  {
    vehicleMake: 'Acura',
    vehicleModel: 'Integra',
    vehicleTrim: 'Type-R',
    vehicleYearBegin: 1995,
    vehicleYearEnd: 2001
  },
  {
    vehicleMake: 'Acura',
    vehicleModel: 'Integra',
    vehicleTrim: null,
    vehicleYearBegin: 1994,
    vehicleYearEnd: 2001
  }
];

describe('comsccCatalogRowsForYear', () => {
  it('returns rows whose year span contains the year', () => {
    const rows = comsccCatalogRowsForYear(sampleCatalog, 'ACURA', 'Integra', 1999);
    expect(rows).toHaveLength(2);
  });
});

describe('comsccTrimChoicesForYear', () => {
  it('returns [] when only null-trim rows apply (implicit base)', () => {
    expect(comsccTrimChoicesForYear(sampleCatalog, 'Acura', 'Integra', 1993)).toEqual([]);
  });

  it('returns Base + named trims when both apply for the year', () => {
    const ch = comsccTrimChoicesForYear(sampleCatalog, 'Acura', 'Integra', 1999);
    expect(ch.map((c) => c.id)).toEqual([COMSCC_TRIM_BASE_SENTINEL, 'Type-R']);
    expect(ch[0].trimKey).toBeNull();
    expect(ch[1].trimKey).toBe('Type-R');
  });

  it('returns a single named trim when no overlapping null row', () => {
    const cat = [
      {
        vehicleMake: 'Acura',
        vehicleModel: 'Integra',
        vehicleTrim: 'Type-R',
        vehicleYearBegin: 1997,
        vehicleYearEnd: 1997
      }
    ];
    const ch = comsccTrimChoicesForYear(cat, 'Acura', 'Integra', 1997);
    expect(ch).toEqual([{ id: 'Type-R', label: 'Type-R', trimKey: 'Type-R' }]);
  });
});
