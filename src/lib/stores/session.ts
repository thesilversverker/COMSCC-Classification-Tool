import { writable } from 'svelte/store';
import type { RuleAnswer, RuleAnswersByQuestionId, RulesDocument } from '$types/rules';

const STORAGE_KEY = 'comscc.classifier.session.v1';

export interface SessionState {
  schemaVersion: string;
  answers: RuleAnswersByQuestionId;
}

const initialState: SessionState = {
  schemaVersion: '1.0.0',
  answers: {}
};

function safeLoad(): SessionState {
  // Logical component: browser-only localStorage hydration.
  if (typeof window === 'undefined') {
    return initialState;
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return initialState;
  }

  try {
    const parsed = JSON.parse(raw) as SessionState;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.schemaVersion !== 'string') {
      return initialState;
    }
    return parsed;
  } catch {
    return initialState;
  }
}

function createSessionStore() {
  const { subscribe, set, update } = writable<SessionState>(safeLoad());

  const persist = (state: SessionState): SessionState => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    return state;
  };

  return {
    subscribe,
    hydrate: () => set(safeLoad()),
    setAnswer: (questionId: string, answer: RuleAnswer) =>
      update((state) =>
        persist({
          ...state,
          answers: {
            ...state.answers,
            [questionId]: answer
          }
        })
      ),
    reset: () => set(persist(initialState)),
    exportSession: (): string => JSON.stringify(safeLoad(), null, 2),
    importSession: (payload: string) => {
      const parsed = JSON.parse(payload) as SessionState;
      set(persist(parsed));
    }
  };
}

export const sessionStore = createSessionStore();

export function calculateCompletion(rules: RulesDocument, answers: RuleAnswersByQuestionId): Record<string, number> {
  // Logical component: category completion percentages.
  return Object.fromEntries(
    rules.categories.map((category) => {
      const total = category.questions.length;
      const answered = category.questions.filter((question) => {
        const value = answers[question.id];
        return value !== undefined && value !== null && value !== '';
      }).length;
      const percent = total === 0 ? 100 : Math.round((answered / total) * 100);
      return [category.id, percent];
    })
  );
}
