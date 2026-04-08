<script lang="ts">
  import { get } from 'svelte/store';
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

    // Logical component: auto-advance from each category's first prompt.
    const nav = get(navigationStore);
    const currentCategory = rules.categories[nav.categoryIndex];
    const currentQuestion = currentCategory?.questions[nav.questionIndex];
    const hasAnswer = value !== null && value !== '';

    if (nav.questionIndex === 0 && currentQuestion?.id === questionId && hasAnswer) {
      navigationStore.nextQuestion(rules);
    }
  }

  $: category = rules.categories[$navigationStore.categoryIndex];
  $: question = category?.questions[$navigationStore.questionIndex];
  $: completion = calculateCompletion(rules, $sessionStore.answers);
  $: selectedModel = typeof $sessionStore.answers.vehicles_model === 'string' ? $sessionStore.answers.vehicles_model : '';
  $: showroomWeightValue = selectedModel ? String(showroomWeightByModel[selectedModel] ?? '') : '';
  $: renderedValue =
    question?.id === 'weight_showroom'
      ? showroomWeightValue
      : ($sessionStore.answers[question?.id ?? ''] ?? null);

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

    {#if question}
      <QuestionRenderer
        {question}
        value={renderedValue}
        answers={$sessionStore.answers}
        onChange={(value) => handleQuestionChange(question.id, value)}
      />
    {:else}
      <section><p>No question available in this category yet.</p></section>
    {/if}

    <SessionSummary rules={rules} answers={$sessionStore.answers} />
  </div>

  <footer class="actions">
    <button type="button" on:click={() => navigationStore.previousQuestion(rules)}>Previous</button>
    <button type="button" on:click={() => navigationStore.nextQuestion(rules)}>Next</button>
    <button type="button" on:click={() => sessionStore.reset()}>Reset session</button>
  </footer>
</main>

<style>
  main { max-width: 1080px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; }
  .layout { display: grid; gap: 1rem; grid-template-columns: minmax(14rem, 1fr) minmax(0, 2fr) minmax(14rem, 1fr); align-items: start; }
  .actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
  button { border: 1px solid #bbb; background: #fff; border-radius: 6px; padding: 0.6rem 0.9rem; cursor: pointer; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
