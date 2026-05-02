import { describe, expect, it } from 'vitest';
import comsccCatalogJson from '../../rules-source/vehicles-comscc-catalog.json';
import showroomLookup from '$data/vehicle-showroom-lookup.json';
import { resolveShowroomForSession, type ComsccCatalogDocument } from '$lib/comscc-seed-showroom';
import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';
import type { RuleAnswersByQuestionId } from '$types/rules';

const SHOWROOM_ROWS = (showroomLookup as { rows: ShowroomLookupRow[] }).rows;
const DOC = comsccCatalogJson as ComsccCatalogDocument;
const CATALOG = DOC.vehicleCatalog ?? [];

describe('resolveShowroomForSession', () => {
  it('uses COMSCC seed when lookup misses trim slug (Mitsubishi Eclipse 1995 GSX)', () => {
    const answers: RuleAnswersByQuestionId = {
      vehicles_make_slug: 'mitsubishi',
      vehicles_make_label: 'Mitsubishi',
      vehicles_model_key: 'ECLIPSE',
      vehicles_model_label: 'Eclipse',
      vehicles_year: '1995',
      vehicles_trim_key: 'GSX',
      vehicles_trim_label: 'GSX'
    };

    const direct = SHOWROOM_ROWS.filter(
      (r) =>
        r.makeNorm === 'mitsubishi' &&
        r.modelNorm === 'eclipse' &&
        r.year === 1995 &&
        r.trimKey &&
        r.trimKey.toLowerCase().includes('gsx')
    );
    expect(direct.length).toBe(0);

    const match = resolveShowroomForSession(answers, SHOWROOM_ROWS, DOC, CATALOG);
    expect(match).not.toBeNull();
    expect(match?.showroomSource).toBe('comscc_seed');
    expect(typeof match?.showroomAssessment).toBe('number');
    expect(match?.showroomAssessment).not.toBeNull();
    expect(match?.comsccEnriched).toBe(true);
  });

  it('still prefers lookup row when it has finite showroom assessment', () => {
    const hit = SHOWROOM_ROWS.find((r) => r.catalogId === 'ov_acura_integra_1993');
    expect(hit).toBeDefined();
    expect(hit?.comsccEnriched).toBe(true);

    const answers: RuleAnswersByQuestionId = {
      vehicles_make_slug: 'acura',
      vehicles_make_label: 'Acura',
      vehicles_model_key: 'INTEGRA',
      vehicles_model_label: 'Integra',
      vehicles_year: '1993',
      vehicles_trim_key: null,
      vehicles_trim_label: null
    };

    const match = resolveShowroomForSession(answers, SHOWROOM_ROWS, DOC, CATALOG);
    expect(match?.catalogId).toBe('ov_acura_integra_1993');
    expect(match?.showroomSource).toBeUndefined();
  });
});
