import { calculateCompletion } from './session';
import type { RulesDocument } from '$types/rules';

const rulesFixture: RulesDocument = {
  schemaVersion: '1.0.0',
  generatedAt: '2026-04-08T00:00:00.000Z',
  sourceWorkbook: 'fixture.xlsx',
  categories: [
    {
      id: 'engine',
      label: 'Engine',
      sheetName: 'Engine',
      questions: [
        { id: 'q1', prompt: 'Question 1', answerType: 'text', sheetName: 'Engine' },
        { id: 'q2', prompt: 'Question 2', answerType: 'number', sheetName: 'Engine' }
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
