import rules from '$data/rules.v1.json';
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
});
