<script lang="ts">
  import rulesJson from '$data/rules.v1.json';
  import openVehicleMakesModels from '$data/open-vehicle-makes-models.json';
  import showroomLookup from '$data/vehicle-showroom-lookup.json';
  import comsccCatalogJson from '../../rules-source/vehicles-comscc-catalog.json';
  import type { ComsccCatalogSeedRow } from '$lib/comscc-catalog-trims';
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
  const COMSCC_VEHICLE_CATALOG: ComsccCatalogSeedRow[] = Array.isArray(
    (comsccCatalogJson as { vehicleCatalog?: unknown }).vehicleCatalog
  )
    ? (comsccCatalogJson as { vehicleCatalog: ComsccCatalogSeedRow[] }).vehicleCatalog
    : [];
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

  // Logical component: Weight subsection order (Competition before Ballast).
  const WEIGHT_SUBCATEGORY_ORDER = ['Competition', 'Ballast'];
  const ENGINE_DYNO_TOGGLE_ID = 'dyno_reclass_selected';

  function sortSubcategoryKeys(keys: string[], categoryId: string): string[] {
    const uniq = [...new Set(keys)];
    if (categoryId === 'weight') {
      return uniq.sort((a, b) => {
        const ia = WEIGHT_SUBCATEGORY_ORDER.indexOf(a);
        const ib = WEIGHT_SUBCATEGORY_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });
    }
    return uniq.sort((a, b) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }

  /** Logical component: Showroom weight is a read-only banner; omit from subcategory stack. */
  function questionsForCategoryUI(cat: RuleCategory, answers: Record<string, RuleAnswer>): RuleQuestion[] {
    if (cat.id === 'weight') {
      let qs = cat.questions.filter((q) => q.id !== 'weight_showroom');
      if (answers.weight_ballast_applies !== true) {
        qs = qs.filter((q) => q.id !== 'weight_ballast');
      }
      return qs;
    }
    if (cat.id === 'engine') {
      return cat.questions.filter((q) => q.id !== ENGINE_DYNO_TOGGLE_ID);
    }
    return cat.questions;
  }

  // Logical component: engine dyno reclass options are source-only extras in rules-source/engine.json.
  function engineDynoQuestions(cat: RuleCategory | undefined): RuleQuestion[] {
    if (!cat || cat.id !== 'engine') return [];
    const dynoRaw = (cat as unknown as { dynoReclassOption?: unknown[] }).dynoReclassOption;
    if (!Array.isArray(dynoRaw)) return [];
    return dynoRaw as RuleQuestion[];
  }

  function isQuestionUsedForAutoTrigger(question: RuleQuestion, answers: Record<string, RuleAnswer>): boolean {
    const value = answers[question.id];
    const manual = answers[`${question.id}__manual`];
    if (question.answerType === 'boolean') {
      return value === true || (typeof manual === 'number' && Number.isFinite(manual));
    }
    if (question.answerType === 'number') {
      return typeof value === 'number' && Number.isFinite(value);
    }
    if (question.answerType === 'select') {
      return typeof value === 'string' && value.length > 0;
    }
    if (question.answerType === 'text') {
      return typeof value === 'string' && value.trim().length > 0;
    }
    return false;
  }

  function buildSubcategoryBlocks(cat: RuleCategory, answers: Record<string, RuleAnswer>): SubcategoryBlock[] {
    const qs = questionsForCategoryUI(cat, answers);
    const keys = sortSubcategoryKeys(
      qs.map((q) => q.subcategory),
      cat.id
    );
    return keys.map((key) => {
      const subQs = qs.filter((q) => q.subcategory === key);
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
  $: subcategoryBlocks = category ? buildSubcategoryBlocks(category, $sessionStore.answers) : [];
  $: vehicleCatalogMatch = findShowroomCatalogMatch(
    $sessionStore.answers,
    SHOWROOM_ROWS,
    COMSCC_VEHICLE_CATALOG
  );
  $: showroomWeightValue =
    vehicleCatalogMatch?.showroomBaseWeightLbs != null
      ? String(vehicleCatalogMatch.showroomBaseWeightLbs)
      : '';
  $: showQuestionStack =
    category?.id === 'vehicles' || (category?.questions?.length ?? 0) > 0;
  $: engineDynoToggleQuestion =
    category?.id === 'engine'
      ? category.questions.find((q) => q.id === ENGINE_DYNO_TOGGLE_ID) ?? null
      : null;
  $: dynoQuestions = engineDynoQuestions(category);
  $: engineManualTrigger =
    category?.id === 'engine'
      ? category.questions.some((q) => q.needsManualPoints && isQuestionUsedForAutoTrigger(q, $sessionStore.answers))
      : false;
  $: dynoToggleAnswer =
    typeof $sessionStore.answers[ENGINE_DYNO_TOGGLE_ID] === 'string'
      ? ($sessionStore.answers[ENGINE_DYNO_TOGGLE_ID] as string)
      : '';
  $: showDynoReclassSection =
    category?.id === 'engine' && (dynoToggleAnswer === 'yes' || engineManualTrigger);
  // Logical component: selecting any manual-point engine item auto-enables Dyno Reclass.
  $: if (category?.id === 'engine' && engineManualTrigger && dynoToggleAnswer !== 'yes') {
    handleQuestionChange(ENGINE_DYNO_TOGGLE_ID, 'yes');
  }

  // Logical component: hide ballast amount when the Ballast checkbox is off; clear stored amount.
  $: if (category?.id === 'weight' && $sessionStore.answers.weight_ballast_applies !== true) {
    const b = $sessionStore.answers.weight_ballast;
    if (typeof b === 'number' && Number.isFinite(b)) {
      handleQuestionChange('weight_ballast', null);
    } else if (typeof b === 'string' && b.trim() !== '') {
      handleQuestionChange('weight_ballast', null);
    }
  }

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
        <p class="running-total">
          <strong>Running category total:</strong>
          {category?.id === 'weight' ? currentCategoryTotal.toFixed(2) : currentCategoryTotal.toFixed(1)} points
        </p>

        {#if category?.id === 'weight'}
          <div class="weight-showroom-banner" role="status" aria-live="polite">
            <p class="weight-showroom-line">
              <strong>Showroom base weight (lbs):</strong>
              {#if showroomWeightValue}
                <span class="weight-showroom-value">{showroomWeightValue}</span>
              {:else}
                <span class="weight-showroom-empty">—</span>
                <span class="weight-showroom-hint">
                  Choose a vehicle in Vehicles (with catalog weight) to fill this automatically.
                </span>
              {/if}
            </p>
          </div>
        {/if}

        {#if category?.id === 'vehicles'}
          <VehiclesPicker
            openMakesModels={openVehicleData}
            comsccVehicleCatalog={COMSCC_VEHICLE_CATALOG}
            showroomRows={SHOWROOM_ROWS}
            answers={$sessionStore.answers}
            onAnswer={handleQuestionChange}
          />
        {/if}

        {#if category?.id === 'engine' && engineDynoToggleQuestion}
          <section class="dyno-toggle-wrap">
            <QuestionRenderer
              question={engineDynoToggleQuestion}
              value={getRenderedValue(engineDynoToggleQuestion.id)}
              manualValue={null}
              answers={$sessionStore.answers}
              onChange={(value) => handleQuestionChange(engineDynoToggleQuestion.id, value)}
              onManualChange={undefined}
            />
          </section>
        {/if}

        {#if showDynoReclassSection && dynoQuestions.length > 0}
          <section class="subcategory-block dyno-reclass-block">
            <h3>Engine &gt; Dyno reclass options</h3>
            {#each dynoQuestions as question (question.id)}
              <QuestionRenderer
                {question}
                vehicleCatalogMatch={vehicleCatalogMatch}
                value={getRenderedValue(question.id)}
                manualValue={$sessionStore.answers[`${question.id}__manual`] ?? null}
                answers={$sessionStore.answers}
                onChange={(value) => handleQuestionChange(question.id, value)}
                onManualChange={(value) => handleQuestionChange(`${question.id}__manual`, value)}
              />
            {/each}
          </section>
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
  .weight-showroom-banner {
    margin: 0;
    padding: 0.65rem 0.85rem;
    border: 1px solid #c5cce8;
    border-radius: 8px;
    background: linear-gradient(180deg, #f4f6ff 0%, #fafbff 100%);
  }
  .weight-showroom-line {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.5;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem 0.6rem;
  }
  .weight-showroom-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .weight-showroom-empty {
    color: #888;
  }
  .weight-showroom-hint {
    font-size: 0.85rem;
    color: #555;
    flex-basis: 100%;
  }
  .subcategory-block { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; display: grid; gap: 0.75rem; }
  .dyno-toggle-wrap { margin: 0; }
  .dyno-reclass-block {
    border-color: #c5cce8;
    background: linear-gradient(180deg, #f4f6ff 0%, #fafbff 100%);
  }
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
