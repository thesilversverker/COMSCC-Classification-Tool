import rules from '$data/rules.v1.json';
import comsccSeed from '../../../rules-source/vehicles-comscc-catalog.json';
import vehiclesSource from '../../../rules-source/vehicles.json';
import { computeComsccDerivedFields } from '../../../scripts/comscc-derived-fields.mjs';
import type { RulesDocument } from './rules';

describe('rules schema', () => {
  // Logical component: schema shape integrity check.
  it('has expected top-level fields', () => {
    const doc = rules as RulesDocument;
    expect(doc.schemaVersion).toBe('1.0.0');
    expect(Array.isArray(doc.categories)).toBe(true);
    expect(doc.categories.length).toBeGreaterThan(0);
  });

  // Logical component: question identity uniqueness check.
  it('has unique question ids', () => {
    const doc = rules as RulesDocument;
    const ids = doc.categories.flatMap((category) => category.questions.map((question) => question.id));
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // Logical component: subcategory required for UI grouping.
  it('assigns a non-empty subcategory to every question', () => {
    const doc = rules as RulesDocument;
    for (const category of doc.categories) {
      for (const question of category.questions) {
        expect(typeof question.subcategory).toBe('string');
        expect(question.subcategory.length).toBeGreaterThan(0);
      }
    }
  });

  it('builds tires as a flat catalog with sort control metadata', () => {
    const doc = rules as RulesDocument;
    const tires = doc.categories.find((c) => c.id === 'tires');
    expect(tires).toBeDefined();
    const model = tires?.questions.find((q) => q.id === 'tires_model');
    expect(model?.selectSortControl).toBe('alpha_points');
    expect((model?.options ?? []).length).toBeGreaterThan(0);
    const opts = model?.options ?? [];
    const hoosierA = opts.find((o) => o.label === 'Hoosier A Compound (All)');
    expect(hoosierA?.points).toBe(10);
    expect(hoosierA?.utqg).toBeNull();
    expect(opts.find((o) => o.label === 'Kumho Ecsta V700')?.utqg).toBe(50);
    expect(opts.find((o) => o.label === 'Hoosier R7')?.points).toBe(6);
  });

  // Logical component: vehicles.json is composed (open-vehicle + styles + COMSCC template/overrides).
  it('vehicles rules-source includes composed vehicleCatalog', () => {
    const cat = (vehiclesSource as { category: { id: string; vehicleCatalog?: unknown[] } }).category;
    expect(cat.id).toBe('vehicles');
    expect(Array.isArray(cat.vehicleCatalog)).toBe(true);
    // Row count follows catalog-scoped Layer 3 (flattened make/model/year/trim), not full-VPIC breadth.
    expect((cat.vehicleCatalog ?? []).length).toBeGreaterThan(1000);
  });

  it('COMSCC catalog defines comsccTemplate with scalars (derived fields computed in JS)', () => {
    const seed = comsccSeed as { comsccTemplate: Record<string, unknown> };
    expect(seed.comsccTemplate).toBeDefined();
    const d = computeComsccDerivedFields(seed.comsccTemplate);
    expect(typeof d.showroomAssessment).toBe('number');
    expect(Number.isFinite(d.showroomAssessment as number)).toBe(true);
  });
});
