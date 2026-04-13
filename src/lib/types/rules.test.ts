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

  it('builds tires from rules-source catalog (class → model options)', () => {
    const doc = rules as RulesDocument;
    const tires = doc.categories.find((c) => c.id === 'tires');
    expect(tires).toBeDefined();
    const model = tires?.questions.find((q) => q.id === 'tires_model');
    expect(model?.optionsByParent?.race_10?.length).toBeGreaterThan(0);
    const hoosier = model?.optionsByParent?.race_10?.find((o) => o.label === 'Hoosier A Compound');
    expect(hoosier?.points).toBe(10);
    expect(hoosier?.utqg).toBeNull();
    expect(model?.optionsByParent?.race_6?.find((o) => o.label === 'Kumho Ecsta V700')?.utqg).toBe(50);
  });

  // Logical component: vehicles.json is composed (open-vehicle + styles + COMSCC template/overrides).
  it('vehicles rules-source includes composed vehicleCatalog', () => {
    const cat = vehiclesSource.category as { id: string; vehicleCatalog?: unknown[] };
    expect(cat.id).toBe('vehicles');
    expect(Array.isArray(cat.vehicleCatalog)).toBe(true);
    expect((cat.vehicleCatalog ?? []).length).toBeGreaterThan(5000);
  });

  it('COMSCC catalog defines comsccTemplate with scalars (derived fields computed in JS)', () => {
    const seed = comsccSeed as { comsccTemplate: Record<string, unknown> };
    expect(seed.comsccTemplate).toBeDefined();
    const d = computeComsccDerivedFields(seed.comsccTemplate);
    expect(typeof d.showroomAssessment).toBe('number');
    expect(Number.isFinite(d.showroomAssessment as number)).toBe(true);
  });
});
