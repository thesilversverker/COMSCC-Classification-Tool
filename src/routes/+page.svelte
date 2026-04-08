<script lang="ts">
  import rulesJson from '$data/rules.v1.json';
  import CategoryNav from '$components/CategoryNav.svelte';
  import QuestionRenderer from '$components/QuestionRenderer.svelte';
  import SessionSummary from '$components/SessionSummary.svelte';
  import { calculateCompletion, sessionStore } from '$stores/session';
  import { navigationStore } from '$stores/navigation';
  import type { RuleAnswer, RuleOption, RuleQuestion, RulesDocument } from '$types/rules';

  const rules = rulesJson as RulesDocument;
  const showroomWeightByModel: Record<string, number> = {
    integra: 2623,
    integra_type_r: 2639,
    nsx: 2976
  };

  // Logical component: typed bridge for answer updates from renderer component.
  function handleQuestionChange(questionId: string, value: RuleAnswer) {
    sessionStore.setAnswer(questionId, value);

    // Logical component: cascade-reset dependent model when make changes.
    if (questionId === 'vehicles_make') {
      sessionStore.setAnswer('vehicles_model', null);
    }
  }

  $: category = rules.categories[$navigationStore.categoryIndex];
  $: completion = calculateCompletion(rules, $sessionStore.answers);
  $: selectedModel = typeof $sessionStore.answers.vehicles_model === 'string' ? $sessionStore.answers.vehicles_model : '';
  $: showroomWeightValue = selectedModel ? String(showroomWeightByModel[selectedModel] ?? '') : '';

  // Logical component: compute display value per question, including derived values.
  function getRenderedValue(questionId: string): RuleAnswer {
    if (questionId === 'weight_showroom') {
      return showroomWeightValue;
    }
    return $sessionStore.answers[questionId] ?? null;
  }

  // Logical component: lookup selected option metadata (including points).
  function getSelectedOption(question: RuleQuestion): RuleOption | undefined {
    const selectedValue = $sessionStore.answers[question.id];
    if (typeof selectedValue !== 'string' || selectedValue === '') {
      return undefined;
    }

    if (question.dependsOn && question.optionsByParent) {
      const parent = $sessionStore.answers[question.dependsOn];
      if (typeof parent !== 'string') {
        return undefined;
      }
      return (question.optionsByParent[parent] ?? []).find((opt) => opt.id === selectedValue);
    }

    return (question.options ?? []).find((opt) => opt.id === selectedValue);
  }

  function toNumeric(value: RuleAnswer): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  // Logical component: split category questions by interaction model for usability.
  $: fixedPointCheckboxQuestions = (category?.questions ?? []).filter(
    (q) => q.answerType === 'boolean' && typeof q.pointValue === 'number'
  );
  $: variablePointCheckboxQuestions = (category?.questions ?? []).filter(
    (q) => q.answerType === 'boolean' && typeof q.pointValue !== 'number'
  );
  $: standardQuestions = (category?.questions ?? []).filter((q) => q.answerType !== 'boolean');

  // Logical component: group fixed-point checkbox items into multi-select lists by point value.
  $: fixedPointGroups = fixedPointCheckboxQuestions.reduce<Record<string, RuleQuestion[]>>((acc, q) => {
    const key = String(q.pointValue);
    if (!acc[key]) acc[key] = [];
    acc[key].push(q);
    return acc;
  }, {});
  $: sortedFixedPointGroupKeys = Object.keys(fixedPointGroups).sort((a, b) => Number(b) - Number(a));

  function getSelectedFixedPointIds(groupQuestions: RuleQuestion[]): string[] {
    return groupQuestions
      .filter((q) => $sessionStore.answers[q.id] === true)
      .map((q) => q.id);
  }

  function handleFixedPointGroupSelection(groupQuestions: RuleQuestion[], selectedIds: string[]) {
    const selected = new Set(selectedIds);
    for (const question of groupQuestions) {
      handleQuestionChange(question.id, selected.has(question.id));
    }
  }

  function handleFixedPointGroupChange(event: Event, groupQuestions: RuleQuestion[]) {
    const selectedIds = Array.from((event.currentTarget as HTMLSelectElement).selectedOptions).map(
      (opt) => opt.value
    );
    handleFixedPointGroupSelection(groupQuestions, selectedIds);
  }

  // Logical component: per-category running total from selected items and manual points.
  function getCategoryTotal(categoryId: string): number {
    const target = rules.categories.find((item) => item.id === categoryId);
    if (!target) return 0;

    let total = 0;
    for (const q of target.questions) {
      if (q.answerType === 'boolean' && $sessionStore.answers[q.id] === true) {
        if (typeof q.pointValue === 'number') {
          total += q.pointValue;
        } else if (q.needsManualPoints) {
          total += toNumeric($sessionStore.answers[`${q.id}__manual`] ?? 0);
        }
      }

      if (q.answerType === 'select') {
        const selectedOption = getSelectedOption(q);
        if (typeof selectedOption?.points === 'number') {
          total += selectedOption.points;
        }
      }

      if (q.id.endsWith('_points')) {
        total += toNumeric($sessionStore.answers[q.id] ?? 0);
      }
    }
    return total;
  }

  $: currentCategoryTotal = category ? getCategoryTotal(category.id) : 0;

  // Logical component: category-only navigation for footer controls.
  function goToNextCategory() {
    const nextIndex = Math.min($navigationStore.categoryIndex + 1, rules.categories.length - 1);
    navigationStore.goToCategory(nextIndex);
  }

  function goToPreviousCategory() {
    const prevIndex = Math.max($navigationStore.categoryIndex - 1, 0);
    navigationStore.goToCategory(prevIndex);
  }

  // Logical component: defensive hydration for SSR/browser transitions.
  if (typeof window !== 'undefined') {
    sessionStore.hydrate();
  }
</script>

<svelte:head>
  <title>COMSCC Classification Tool</title>
</svelte:head>

<main>
  <header>
    <h1>COMSCC Classification Tool</h1>
    <p>Static MVP scaffold with browser-only session storage.</p>
  </header>

  <div class="layout">
    <CategoryNav
      categories={rules.categories}
      completion={completion}
      activeCategoryId={category?.id ?? ''}
      onSelect={(index) => navigationStore.goToCategory(index)}
    />

    {#if category?.questions?.length}
      <section class="question-stack">
        <p class="running-total"><strong>Running category total:</strong> {currentCategoryTotal.toFixed(1)} points</p>

        {#if sortedFixedPointGroupKeys.length > 0}
          <section class="fixed-groups">
            <h2>Select items by assessed points</h2>
            {#each sortedFixedPointGroupKeys as key (key)}
              {@const groupQuestions = fixedPointGroups[key]}
              <label class="multi-group">
                <span>{Number(key) >= 0 ? '+' : ''}{key} points items</span>
                <select
                  multiple
                  on:change={(event) => handleFixedPointGroupChange(event, groupQuestions)}
                >
                  {#each groupQuestions as question (question.id)}
                    <option value={question.id} selected={getSelectedFixedPointIds(groupQuestions).includes(question.id)}>
                      {question.prompt}
                    </option>
                  {/each}
                </select>
              </label>
            {/each}
          </section>
        {/if}

        {#each variablePointCheckboxQuestions as question (question.id)}
          <QuestionRenderer
            {question}
            value={getRenderedValue(question.id)}
            manualValue={$sessionStore.answers[`${question.id}__manual`] ?? null}
            answers={$sessionStore.answers}
            onChange={(value) => handleQuestionChange(question.id, value)}
            onManualChange={(value) => handleQuestionChange(`${question.id}__manual`, value)}
          />
        {/each}

        {#each standardQuestions as question (question.id)}
          <QuestionRenderer
            {question}
            value={getRenderedValue(question.id)}
            manualValue={$sessionStore.answers[`${question.id}__manual`] ?? null}
            answers={$sessionStore.answers}
            onChange={(value) => handleQuestionChange(question.id, value)}
            onManualChange={undefined}
          />
        {/each}
      </section>
    {:else}
      <section><p>No question available in this category yet.</p></section>
    {/if}

    <SessionSummary rules={rules} answers={$sessionStore.answers} />
  </div>

  <footer class="actions">
    <button type="button" on:click={goToPreviousCategory} disabled={$navigationStore.categoryIndex === 0}>Previous Category</button>
    <button type="button" on:click={goToNextCategory} disabled={$navigationStore.categoryIndex === rules.categories.length - 1}>Next Category</button>
    <button type="button" on:click={() => sessionStore.reset()}>Reset session</button>
  </footer>
</main>

<style>
  main { max-width: 1080px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  .layout { display: grid; gap: 1rem; grid-template-columns: minmax(14rem, 1fr) minmax(0, 2fr) minmax(14rem, 1fr); align-items: start; }
  .actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
  .question-stack { display: grid; gap: 0.75rem; min-width: 0; }
  .running-total { margin: 0; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 8px; background: #f8f8f8; }
  .fixed-groups { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; display: grid; gap: 0.75rem; }
  .fixed-groups h2 { margin: 0; font-size: 1rem; }
  .multi-group { display: grid; gap: 0.35rem; }
  .multi-group span { font-size: 0.9rem; color: #444; }
  .multi-group select { min-height: 8.5rem; border: 1px solid #bbb; border-radius: 6px; padding: 0.35rem; }
  button { border: 1px solid #bbb; background: #fff; border-radius: 6px; padding: 0.6rem 0.9rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
