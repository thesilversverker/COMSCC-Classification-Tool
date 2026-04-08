import { derived, writable } from 'svelte/store';
import type { RulesDocument } from '$types/rules';

export interface NavigationState {
  categoryIndex: number;
  questionIndex: number;
}

const initialNavigation: NavigationState = {
  categoryIndex: 0,
  questionIndex: 0
};

function createNavigationStore() {
  const { subscribe, set, update } = writable<NavigationState>(initialNavigation);

  return {
    subscribe,
    reset: () => set(initialNavigation),
    goToCategory: (categoryIndex: number) =>
      set({
        categoryIndex,
        questionIndex: 0
      }),
    nextQuestion: (rules: RulesDocument) =>
      update((state) => {
        // Logical component: bounded next-step navigation across categories.
        const category = rules.categories[state.categoryIndex];
        if (!category) {
          return state;
        }

        if (state.questionIndex < category.questions.length - 1) {
          return { ...state, questionIndex: state.questionIndex + 1 };
        }

        if (state.categoryIndex < rules.categories.length - 1) {
          return { categoryIndex: state.categoryIndex + 1, questionIndex: 0 };
        }

        return state;
      }),
    previousQuestion: (rules: RulesDocument) =>
      update((state) => {
        // Logical component: bounded previous-step navigation across categories.
        if (state.questionIndex > 0) {
          return { ...state, questionIndex: state.questionIndex - 1 };
        }

        if (state.categoryIndex > 0) {
          const previousCategory = rules.categories[state.categoryIndex - 1];
          return {
            categoryIndex: state.categoryIndex - 1,
            questionIndex: Math.max(previousCategory.questions.length - 1, 0)
          };
        }

        return state;
      })
  };
}

export const navigationStore = createNavigationStore();

export const hasProgress = derived(navigationStore, (state) => state.categoryIndex > 0 || state.questionIndex > 0);
