import { calculateCompletion } from './session';
import type { RulesDocument } from '$types/rules';

const rulesFixture: RulesDocument = {
  schemaVersion: '1.0.0',
  categories: [
    {
      id: 'engine',
      label: 'Engine',
      questions: [
        { id: 'q1', prompt: 'Question 1', subcategory: 'Other', answerType: 'text' },
        { id: 'q2', prompt: 'Question 2', subcategory: 'Other', answerType: 'number' }
      ]
    }
  ]
};

describe('session completion', () => {
  // Logical component: completion percentage behavior test.
  it('calculates completion percentage for categories', () => {
    const result = calculateCompletion(rulesFixture, { q1: 'yes' });
    expect(result.engine).toBe(50);
  });
});
