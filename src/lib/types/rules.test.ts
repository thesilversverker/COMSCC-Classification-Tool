import rules from '$data/rules.v1.json';
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

  // Logical component: Vehicles rules-source mirrors workbook showroom table including column N.
  it('vehicles source catalog includes showroom assessment from column N', () => {
    const cat = vehiclesSource.category as {
      vehicleCatalog?: { showroomAssessment: number | null; sourceRef: string; make: string; model: string }[];
    };
    expect(cat.vehicleCatalog?.length).toBeGreaterThan(400);
    const integra = cat.vehicleCatalog?.find(
      (v) => v.make === 'Acura' && v.model === 'Integra' && v.sourceRef === 'Vehicles!N13'
    );
    expect(integra?.showroomAssessment).toBeCloseTo(24.62746305418719, 5);
  });
});
