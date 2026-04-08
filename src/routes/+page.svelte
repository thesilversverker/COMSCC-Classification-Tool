<script lang="ts">
  import rulesJson from '$data/rules.v1.json';
  import openVehicleMakesModels from '$data/open-vehicle-makes-models.json';
  import showroomLookup from '$data/vehicle-showroom-lookup.json';
  import CategoryNav from '$components/CategoryNav.svelte';
  import ClassificationBanner from '$components/ClassificationBanner.svelte';
  import QuestionRenderer from '$components/QuestionRenderer.svelte';
  import SessionSummary from '$components/SessionSummary.svelte';
  import VehiclesPicker from '$components/VehiclesPicker.svelte';
  import { computeAllCategoryPoints } from '$lib/scoring';
  import { findShowroomCatalogMatch } from '$lib/vehicles-showroom-match';
  import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';
  import { sessionStore } from '$stores/session';
  import { navigationStore } from '$stores/navigation';
  import type { RuleAnswer, RuleCategory, RuleQuestion, RulesDocument } from '$types/rules';

  // Logical component: COMSCC showroom rows + open-vehicle-db make/model tree for the Vehicles picker.
  const SHOWROOM_ROWS = (showroomLookup as { rows: ShowroomLookupRow[] }).rows;
  type OpenDbMake = {
    make_slug: string;
    make_name: string;
    models: Record<
      string,
      {
        model_id: number;
        model_name: string;
        model_styles: Record<string, { years?: number[] } & Record<string, unknown>>;
        vehicle_type: string;
        years: number[];
      }
    >;
    first_year: number;
    last_year: number;
  };
  const openVehicleData = openVehicleMakesModels as unknown as OpenDbMake[];

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

  // Logical component: typed bridge for answer updates from renderer component.
  function handleQuestionChange(questionId: string, value: RuleAnswer) {
    sessionStore.setAnswer(questionId, value);
  }

  $: category = rules.categories[$navigationStore.categoryIndex];
  $: categoryPointsById = computeAllCategoryPoints(rules.categories, $sessionStore.answers);
  $: currentCategoryTotal = category ? (categoryPointsById[category.id] ?? 0) : 0;
  $: subcategoryBlocks = category ? buildSubcategoryBlocks(category) : [];
  $: vehicleCatalogMatch = findShowroomCatalogMatch($sessionStore.answers, SHOWROOM_ROWS);
  $: showroomWeightValue =
    vehicleCatalogMatch?.showroomBaseWeightLbs != null
      ? String(vehicleCatalogMatch.showroomBaseWeightLbs)
      : '';
  $: showQuestionStack =
    category?.id === 'vehicles' || (category?.questions?.length ?? 0) > 0;

  // Logical component: optional primary tire width (mm) for spec comparison in the classification banner.
  function parseOptionalTireWidthMm(answer: RuleAnswer): number | null {
    if (typeof answer === 'number' && Number.isFinite(answer)) return answer;
    if (typeof answer === 'string' && answer.trim() !== '') {
      const n = Number(answer);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }
  $: declaredTireWidthMm = parseOptionalTireWidthMm($sessionStore.answers.tires_width_mm);

  // Logical component: compute display value per question, including derived values.
  function getRenderedValue(questionId: string): RuleAnswer {
    if (questionId === 'weight_showroom') {
      return showroomWeightValue;
    }
    return $sessionStore.answers[questionId] ?? null;
  }

  function handleFixedPointToggle(question: RuleQuestion, checked: boolean) {
    handleQuestionChange(question.id, checked);
  }

  function handleFixedPointInputChange(event: Event, question: RuleQuestion) {
    handleFixedPointToggle(question, (event.currentTarget as HTMLInputElement).checked);
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

  <ClassificationBanner
    categories={rules.categories}
    categoryPoints={categoryPointsById}
    declaredTireWidthMm={declaredTireWidthMm}
  />

  <div class="layout">
    <CategoryNav
      categories={rules.categories}
      categoryPoints={categoryPointsById}
      activeCategoryId={category?.id ?? ''}
      onSelect={(index) => navigationStore.goToCategory(index)}
    />

    {#if showQuestionStack}
      <section class="question-stack">
        <p class="running-total"><strong>Running category total:</strong> {currentCategoryTotal.toFixed(1)} points</p>

        {#if category?.id === 'vehicles'}
          <VehiclesPicker
            openMakesModels={openVehicleData}
            showroomRows={SHOWROOM_ROWS}
            answers={$sessionStore.answers}
            onAnswer={handleQuestionChange}
          />
        {/if}

        {#each subcategoryBlocks as block (block.key)}
          <section class="subcategory-block">
            <h3>{category.label} &gt; {block.key}</h3>
            {#if block.fixed.length > 0}
              <div class="fixed-list" role="group" aria-label="Fixed-assessment items">
                <span class="fixed-list-label">Fixed-assessment items (select all that apply)</span>
                {#each block.fixed as question (question.id)}
                  <label class="fixed-item">
                    <input
                      type="checkbox"
                      checked={$sessionStore.answers[question.id] === true}
                      on:change={(event) => handleFixedPointInputChange(event, question)}
                    />
                    <span class="fixed-item-text">
                      {typeof question.pointValue === 'number' && question.pointValue >= 0 ? '+' : ''}{question.pointValue}
                      —
                      {question.prompt}
                    </span>
                  </label>
                {/each}
              </div>
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
  main { max-width: 1080px; margin: 0 auto; padding: 1rem; font-family: system-ui, sans-serif; min-width: 0; }
  header h1 { line-height: 1.25; overflow-wrap: anywhere; word-break: break-word; }
  header p { overflow-wrap: anywhere; }
  .layout { display: grid; gap: 1rem; grid-template-columns: minmax(14rem, 1fr) minmax(0, 2fr) minmax(14rem, 1fr); align-items: start; }
  .actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
  .question-stack { display: grid; gap: 0.75rem; min-width: 0; }
  .running-total { margin: 0; padding: 0.5rem 0.75rem; border: 1px solid #ddd; border-radius: 8px; background: #f8f8f8; }
  .subcategory-block { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; display: grid; gap: 0.75rem; }
  .subcategory-block h3 { margin: 0; font-size: 1rem; font-weight: 600; }
  .fixed-list { display: grid; gap: 0.45rem; min-width: 0; }
  .fixed-list-label { font-size: 0.9rem; color: #444; line-height: 1.4; overflow-wrap: anywhere; }
  .fixed-item {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.45rem 0.5rem;
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    background: #fafafa;
    cursor: pointer;
    min-width: 0;
  }
  .fixed-item input { margin-top: 0.2rem; flex-shrink: 0; }
  .fixed-item-text {
    font-size: 0.92rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    word-break: break-word;
    min-width: 0;
  }
  button { border: 1px solid #bbb; background: #fff; border-radius: 6px; padding: 0.6rem 0.9rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
