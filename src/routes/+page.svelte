<script lang="ts">
  import rulesJson from '$data/rules.v1.json';
  import CategoryNav from '$components/CategoryNav.svelte';
  import QuestionRenderer from '$components/QuestionRenderer.svelte';
  import SessionSummary from '$components/SessionSummary.svelte';
  import { calculateCompletion, sessionStore } from '$stores/session';
  import { navigationStore } from '$stores/navigation';
  import type { RuleAnswer, RulesDocument } from '$types/rules';

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
        {#each category.questions as question (question.id)}
          <QuestionRenderer
            {question}
            value={getRenderedValue(question.id)}
            answers={$sessionStore.answers}
            onChange={(value) => handleQuestionChange(question.id, value)}
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
  button { border: 1px solid #bbb; background: #fff; border-radius: 6px; padding: 0.6rem 0.9rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
