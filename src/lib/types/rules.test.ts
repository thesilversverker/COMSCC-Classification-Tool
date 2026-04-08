import rules from '$data/rules.v1.json';
import comsccSeed from '../../../rules-source/vehicles-comscc-catalog.json';
import vehiclesSource from '../../../rules-source/vehicles.json';
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

  // Logical component: slim vehicles.json (no embedded catalog); COMSCC seed is rules-source/vehicles-comscc-catalog.json; lookup built at data:build.
  it('vehicles rules-source has category metadata only (no vehicleCatalog)', () => {
    const cat = vehiclesSource.category as { id: string; vehicleCatalog?: unknown[] };
    expect(cat.id).toBe('vehicles');
    expect(cat.vehicleCatalog).toBeUndefined();
  });

  it('COMSCC seed has showroom assessment for a representative workbook row', () => {
    const catalog = (comsccSeed as { vehicleCatalog: Array<Record<string, unknown>> }).vehicleCatalog;
    const integra = catalog.find(
      (r) =>
        r.make === 'Acura' &&
        r.model === 'Integra' &&
        typeof r.startYear === 'number' &&
        typeof r.endYear === 'number' &&
        1993 >= r.startYear &&
        1993 <= r.endYear
    );
    expect(typeof integra?.showroomAssessment).toBe('number');
    expect(integra?.showroomAssessment as number).toBeCloseTo(24.62746305418719, 5);
  });
});
