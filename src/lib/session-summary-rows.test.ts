import { describe, expect, it } from 'vitest';
import rulesJson from '$data/rules.v1.json';
import { computeCategoryPoints, computeAllCategoryPoints } from '$lib/scoring';
import type { RulesDocument } from '$types/rules';
import { buildSessionSummaryPayload, formatVehicleSummaryLine, sessionSummaryToCsv } from './session-summary-rows';

const rules = rulesJson as RulesDocument;

describe('session-summary-rows', () => {
  it('formats vehicle line from answer labels', () => {
    expect(
      formatVehicleSummaryLine({
        vehicles_make_label: 'Acura',
        vehicles_model_label: 'Integra',
        vehicles_year: '1994',
        vehicles_trim_label: 'GS-R'
      })
    ).toBe('Acura Integra 1994 (GS-R)');
    expect(formatVehicleSummaryLine({})).toBe('No vehicle selected');
  });

  it('keeps vehicles showroom row points aligned with scoring', () => {
    const answers = {
      vehicles_make_label: 'ACURA',
      vehicles_model_label: 'INTEGRA',
      vehicles_year: '2024',
      vehicles_trim_key: null,
      vehicles_trim_label: null
    };
    const payload = buildSessionSummaryPayload(rules.categories, answers);
    const vehiclesCat = rules.categories.find((c) => c.id === 'vehicles')!;
    const expected = computeCategoryPoints(vehiclesCat, answers, rules.categories);
    const vehiclesRow = payload.rows.find((r) => r.categoryId === 'vehicles');
    expect(vehiclesRow?.points).toBeCloseTo(expected, 5);
    expect(vehiclesRow?.label).toContain('unevaluated vehicle');
  });

  it('labels COMSCC-enriched showroom row as catalog match', () => {
    const answers = {
      vehicles_make_label: 'ACURA',
      vehicles_model_label: 'INTEGRA',
      vehicles_year: '1993',
      vehicles_trim_key: null,
      vehicles_trim_label: null
    };
    const payload = buildSessionSummaryPayload(rules.categories, answers);
    const vehiclesRow = payload.rows.find((r) => r.categoryId === 'vehicles');
    expect(vehiclesRow?.label).toContain('catalog match');
  });

  it('includes CSV header fields and final class', () => {
    const p = buildSessionSummaryPayload(rules.categories, {});
    const csv = sessionSummaryToCsv(p);
    expect(csv).toContain('Vehicle');
    expect(csv).toContain('Competition weight');
    expect(csv).toContain('Final class');
    expect(csv).toContain(p.finalClass);
    expect(csv).toContain('Total modification points');
  });

  it('matches grand total from computeAllCategoryPoints', () => {
    const answers = {
      vehicles_make_label: 'ACURA',
      vehicles_model_label: 'INTEGRA',
      vehicles_year: '2024'
    };
    const pts = computeAllCategoryPoints(rules.categories, answers);
    const grand = Object.values(pts).reduce((a, b) => a + b, 0);
    const p = buildSessionSummaryPayload(rules.categories, answers);
    expect(p.grandModificationPoints).toBeCloseTo(grand, 5);
  });
});
