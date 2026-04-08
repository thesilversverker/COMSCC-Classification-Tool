<script lang="ts">
  import rulesJson from '$data/rules.v1.json';
  import CategoryNav from '$components/CategoryNav.svelte';
  import QuestionRenderer from '$components/QuestionRenderer.svelte';
  import SessionSummary from '$components/SessionSummary.svelte';
  import { computeAllCategoryPoints } from '$lib/scoring';
  import { sessionStore } from '$stores/session';
  import { navigationStore } from '$stores/navigation';
  import type { RuleAnswer, RuleCategory, RuleQuestion, RulesDocument } from '$types/rules';

  // Logical component: one UI block per subcategory (fixed multi-select, then variable booleans, then other types).
  type SubcategoryBlock = {
    key: string;
    fixed: RuleQuestion[];
    variable: RuleQuestion[];
    standard: RuleQuestion[];
  };

  function sortSubcategoryKeys(keys: string[]): string[] {
    const uniq = [...new Set(keys)];
    return uniq.sort((a, b) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }

  function buildSubcategoryBlocks(cat: RuleCategory): SubcategoryBlock[] {
    const keys = sortSubcategoryKeys(cat.questions.map((q) => q.subcategory));
    return keys.map((key) => {
      const subQs = cat.questions.filter((q) => q.subcategory === key);
      return {
        key,
        fixed: subQs.filter((q) => q.answerType === 'boolean' && typeof q.pointValue === 'number'),
        variable: subQs.filter((q) => q.answerType === 'boolean' && typeof q.pointValue !== 'number'),
        standard: subQs.filter((q) => q.answerType !== 'boolean')
      };
    });
  }

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
  $: categoryPointsById = computeAllCategoryPoints(rules.categories, $sessionStore.answers);
  $: currentCategoryTotal = category ? (categoryPointsById[category.id] ?? 0) : 0;
  $: subcategoryBlocks = category ? buildSubcategoryBlocks(category) : [];
  $: selectedModel = typeof $sessionStore.answers.vehicles_model === 'string' ? $sessionStore.answers.vehicles_model : '';
  $: showroomWeightValue = selectedModel ? String(showroomWeightByModel[selectedModel] ?? '') : '';

  // Logical component: compute display value per question, including derived values.
  function getRenderedValue(questionId: string): RuleAnswer {
    if (questionId === 'weight_showroom') {
      return showroomWeightValue;
    }
    return $sessionStore.answers[questionId] ?? null;
  }

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
      categoryPoints={categoryPointsById}
      activeCategoryId={category?.id ?? ''}
      onSelect={(index) => navigationStore.goToCategory(index)}
    />

    {#if category?.questions?.length}
      <section class="question-stack">
        <p class="running-total"><strong>Running category total:</strong> {currentCategoryTotal.toFixed(1)} points</p>

        {#each subcategoryBlocks as block (block.key)}
          <section class="subcategory-block">
            <h3>{category.label} &gt; {block.key}</h3>
            {#if block.fixed.length > 0}
              <label class="multi-group">
                <span>Fixed-assessment items (select all that apply)</span>
                <select
                  multiple
                  on:change={(event) => handleFixedPointGroupChange(event, block.fixed)}
                >
                  {#each block.fixed as question (question.id)}
                    <option
                      value={question.id}
                      selected={getSelectedFixedPointIds(block.fixed).includes(question.id)}
                    >
                      {typeof question.pointValue === 'number' && question.pointValue >= 0 ? '+' : ''}{question.pointValue} — {question.prompt}
                    </option>
                  {/each}
                </select>
              </label>
            {/if}
            {#each block.variable as question (question.id)}
              <QuestionRenderer
                {question}
                value={getRenderedValue(question.id)}
                manualValue={$sessionStore.answers[`${question.id}__manual`] ?? null}
                answers={$sessionStore.answers}
                onChange={(value) => handleQuestionChange(question.id, value)}
                onManualChange={(value) => handleQuestionChange(`${question.id}__manual`, value)}
              />
            {/each}
            {#each block.standard as question (question.id)}
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
  .subcategory-block { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; display: grid; gap: 0.75rem; }
  .subcategory-block h3 { margin: 0; font-size: 1rem; font-weight: 600; }
  .multi-group { display: grid; gap: 0.35rem; }
  .multi-group span { font-size: 0.9rem; color: #444; }
  .multi-group select { min-height: 8.5rem; border: 1px solid #bbb; border-radius: 6px; padding: 0.35rem; }
  button { border: 1px solid #bbb; background: #fff; border-radius: 6px; padding: 0.6rem 0.9rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
