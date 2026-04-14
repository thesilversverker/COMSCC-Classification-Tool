<script lang="ts">
  import {
    DYNO_POINTS_ABOVE_BASE_SYMBOLIC,
    dynoLossFraction,
    explainDynoPointsAboveBaseFromSession,
    formatDynoPointsAboveBaseExplanation,
    scaledPowerFromDynoAnswers
  } from '$lib/dyno-reclass-math';
  import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';
  import type { RuleAnswer, RuleOption, RuleQuestion } from '$types/rules';

  // Logical component: tire catalog (and similar) — reorder flat select options without mutating rules.
  function sortSelectOptionsForMode(options: RuleOption[], mode: 'alpha' | 'points'): RuleOption[] {
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    const copy = [...options];
    if (mode === 'alpha') {
      copy.sort((a, b) => collator.compare(a.label, b.label));
      return copy;
    }
    copy.sort((a, b) => {
      const pa = typeof a.points === 'number' ? a.points : 0;
      const pb = typeof b.points === 'number' ? b.points : 0;
      if (pb !== pa) return pb - pa;
      return collator.compare(a.label, b.label);
    });
    return copy;
  }

  export let question: RuleQuestion;
  export let value: RuleAnswer;
  export let answers: Record<string, RuleAnswer> = {};
  /** Logical component: vehicle row for dyno baseline (weight + factory HP/torque). */
  export let vehicleCatalogMatch: ShowroomLookupRow | null = null;
  /** Logical component: optional manual points when workbook assessment is unclear (e.g. Dyno). */
  export let manualValue: RuleAnswer = null;
  export let onChange: (value: RuleAnswer) => void;
  export let onManualChange: ((value: RuleAnswer) => void) | undefined = undefined;

  // Logical component: dependent option resolution for cascading dropdowns; flat `options` otherwise.
  let tireSortMode: 'alpha' | 'points' = 'alpha';
  $: parentValue = question.dependsOn ? answers[question.dependsOn] : null;
  $: selectOptionsBase =
    question.answerType === 'select'
      ? question.dependsOn && question.optionsByParent && typeof parentValue === 'string'
        ? question.optionsByParent[parentValue] ?? []
        : question.options ?? []
      : [];
  $: selectOptionsForSelect =
    question.answerType === 'select' && question.selectSortControl === 'alpha_points'
      ? sortSelectOptionsForMode(selectOptionsBase, tireSortMode)
      : selectOptionsBase;

  function handleBooleanChange(event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    onChange(checked);
    // Logical component: per-piece exterior (etc.) defaults count to 1 on check, clears on uncheck.
    if (question.pointQuantityMultiplier === true && onManualChange) {
      if (!checked) onManualChange(null);
      else {
        const q = manualValue;
        if (q === null || q === undefined || q === '') onManualChange(1);
      }
    }
  }

  function handleNumberChange(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value;
    onChange(raw === '' ? null : Number(raw));
  }

  function handleSelectChange(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    onChange(raw === '' ? null : raw);
  }

  function handleTextChange(event: Event) {
    const raw = (event.currentTarget as HTMLInputElement).value;
    if (!question.numericOnly) {
      onChange(raw);
      return;
    }

    const digitsOnly = raw.replace(/\D/g, '').slice(0, question.digits ?? raw.length);
    onChange(digitsOnly);
  }

  function handleManualPointsChange(event: Event) {
    if (!onManualChange) return;
    const raw = (event.currentTarget as HTMLInputElement).value;
    onManualChange(raw === '' ? null : Number(raw));
  }

  function handlePieceCountChange(event: Event) {
    if (!onManualChange) return;
    const raw = (event.currentTarget as HTMLInputElement).value;
    if (raw === '') {
      onManualChange(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onManualChange(Math.max(0, Math.floor(n)));
  }

  // Logical component: human-readable points suffix for checkbox items.
  $: pointsLabel =
    typeof question.pointValue === 'number' && question.pointQuantityMultiplier === true
      ? `(+${question.pointValue} pts × piece count below)`
      : typeof question.pointValue === 'number'
      ? `(${question.pointValue >= 0 ? '+' : ''}${question.pointValue} pts)`
      : question.dynoReclassTrigger === true
        ? '(Dyno reclass required)'
        : question.needsManualPoints
          ? 'Dyno reclass required'
          : '';

  // Logical component: formula display text for dyno-specific computed/info-only questions.
  $: formulaDisplay =
    question.id === 'dyno_loss_percent'
      ? (() => {
          const d = answers.dyno_drivetrain_type;
          const loss = dynoLossFraction(typeof d === 'string' ? d : null);
          return loss === null ? 'Select drivetrain type to determine loss %.' : `${(loss * 100).toFixed(0)}%`;
        })()
      : question.id === 'scaled_power_formula'
        ? (() => {
            const scaled = scaledPowerFromDynoAnswers(answers);
            return scaled === null
              ? 'Enter Wheel HP, Peak Torque, and drivetrain type to calculate scaled power.'
              : `${scaled.toFixed(2)}`;
          })()
        : question.id === 'dyno_points_above_base_assessment'
          ? ''
          : question.prompt;

  $: dynoPointsExplanation =
    question.id === 'dyno_points_above_base_assessment'
      ? explainDynoPointsAboveBaseFromSession({
          answers,
          showroomBaseWeightLbs: vehicleCatalogMatch?.showroomBaseWeightLbs ?? null,
          factoryRatedHp: vehicleCatalogMatch?.factoryRatedHp ?? null,
          factoryRatedTorqueLbFt: vehicleCatalogMatch?.factoryRatedTorqueLbFt ?? null,
          performanceAdjustment: vehicleCatalogMatch?.performanceAdjustment ?? null,
          showroomAssessment: vehicleCatalogMatch?.showroomAssessment ?? null
        })
      : null;

  $: hideFormulaBodyForHeadingOnly = question.id === 'dyno_reclass_documentation_required';
</script>

{#if question.answerType === 'boolean'}
  <!-- Logical component: compact checkbox row with optional manual points field -->
  <section class="checkbox-item">
    <label class="checkbox-label">
      <input type="checkbox" checked={Boolean(value)} on:change={handleBooleanChange} />
      <span class="prompt">{question.prompt}</span>
      {#if pointsLabel}
        <span class="pts">{pointsLabel}</span>
      {/if}
    </label>
    {#if question.helpText}
      <p class="help">{question.helpText}</p>
    {/if}
    {#if question.pointQuantityMultiplier === true && Boolean(value) && onManualChange}
      <div class="piece-count-block">
        <label>
          Number of pieces (min 0; each counts +{typeof question.pointValue === 'number' ? question.pointValue : 0} pts)
          <input
            type="number"
            min="0"
            step="1"
            value={typeof manualValue === 'number' && Number.isFinite(manualValue) ? Math.max(0, Math.floor(manualValue)) : 1}
            on:input={handlePieceCountChange}
          />
        </label>
      </div>
    {:else if question.needsManualPoints && Boolean(value) && onManualChange}
      <div class="manual-points">
        <label>
          Points for this line
          <input
            type="number"
            step="any"
            value={typeof manualValue === 'number' ? manualValue : ''}
            on:input={handleManualPointsChange}
          />
        </label>
      </div>
    {/if}
  </section>
{:else}
  <section class="block-item">
    <h2>{question.prompt}</h2>
    {#if question.helpText}
      <p>{question.helpText}</p>
    {/if}

    {#if question.answerType === 'number'}
      {#if question.needsManualPoints}
        <p class="manual-assessment-tag">Manual assessed points — use when the workbook catalog does not supply a value.</p>
      {/if}
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        inputmode="numeric"
        min={question.id === 'vehicles_model_year' ? 1000 : undefined}
        max={question.id === 'vehicles_model_year' ? 9999 : undefined}
        on:input={handleNumberChange}
        readonly={question.readOnly}
      />
    {:else if question.answerType === 'select'}
      {#if question.selectSortControl === 'alpha_points'}
        <div class="select-sort-bar" role="group" aria-label="Sort options">
          <span class="select-sort-label">Sort</span>
          <label class="select-sort-choice">
            <input type="radio" bind:group={tireSortMode} name={`tire-sort-${question.id}`} value="alpha" />
            A–Z
          </label>
          <label class="select-sort-choice">
            <input type="radio" bind:group={tireSortMode} name={`tire-sort-${question.id}`} value="points" />
            By points
          </label>
        </div>
      {/if}
      <select
        value={typeof value === 'string' ? value : ''}
        on:change={handleSelectChange}
        disabled={Boolean(question.dependsOn) && selectOptionsBase.length === 0}
      >
        <option value="">Select an option</option>
        {#each selectOptionsForSelect as option}
          <option value={option.id}>
            {option.label}{typeof option.utqg === 'number' ? ` — UTQG ${option.utqg}` : ''}{typeof option.points ===
            'number' && question.selectSortControl === 'alpha_points'
              ? ` — ${option.points >= 0 ? '+' : ''}${option.points} pts`
              : ''}
          </option>
        {/each}
      </select>
    {:else if question.answerType === 'formula'}
      {#if !hideFormulaBodyForHeadingOnly}
        {#if question.id === 'dyno_points_above_base_assessment'}
          <div class="dyno-points-formula">
            {#if dynoPointsExplanation}
              <p class="manual-assessment-tag formula-readonly formula-result">
                <strong>Result:</strong>
                {dynoPointsExplanation.result.toFixed(2)} pts
                {#if dynoPointsExplanation.clampedToMinusTwo}
                  <span class="floor-note"> (workbook floor: raw below −2)</span>
                {/if}
              </p>
              <pre class="dyno-eq-pre">{formatDynoPointsAboveBaseExplanation(dynoPointsExplanation)}</pre>
            {:else}
              <pre class="dyno-eq-pre dyno-eq-pending">{DYNO_POINTS_ABOVE_BASE_SYMBOLIC}

Complete vehicle match (catalog weight + factory HP/torque) and dyno peak HP/torque + drivetrain to substitute numbers.</pre>
            {/if}
          </div>
        {:else}
          <p class="manual-assessment-tag formula-readonly">{formulaDisplay}</p>
        {/if}
      {/if}
    {:else}
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        inputmode={question.numericOnly ? 'numeric' : 'text'}
        maxlength={question.digits}
        placeholder={question.placeholder}
        on:input={handleTextChange}
        readonly={question.readOnly}
      />
    {/if}
  </section>
{/if}

<style>
  .checkbox-item {
    border: 1px solid #e5e5e5;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    min-width: 0;
  }
  .checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1.35;
  }
  .checkbox-label input {
    margin-top: 0.2rem;
    flex-shrink: 0;
  }
  .prompt {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .pts {
    color: #555;
    font-size: 0.85rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
    word-break: break-word;
    min-width: 0;
  }
  .help {
    margin: 0.35rem 0 0 1.5rem;
    font-size: 0.85rem;
    color: #666;
  }
  .manual-points,
  .piece-count-block {
    margin: 0.5rem 0 0 1.5rem;
  }
  .manual-points label,
  .piece-count-block label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .manual-points input,
  .piece-count-block input {
    max-width: 12rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid #bbb;
    border-radius: 6px;
    box-sizing: border-box;
  }

  .block-item {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 1rem;
    min-width: 0;
  }
  .block-item h2 {
    margin: 0 0 0.5rem;
    font-size: 1.05rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .manual-assessment-tag {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    color: #5a5a7a;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .formula-readonly {
    margin: 0;
    padding: 0.5rem 0.65rem;
    border: 1px dashed #c7cae0;
    border-radius: 6px;
    background: #f8f9ff;
  }
  .dyno-points-formula {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }
  .formula-result .floor-note {
    font-weight: 500;
    color: #6a5080;
  }
  .dyno-eq-pre {
    margin: 0;
    padding: 0.55rem 0.65rem;
    border: 1px solid #d8dcf0;
    border-radius: 6px;
    background: #fafbff;
    font-size: 0.82rem;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  }
  .dyno-eq-pending {
    color: #444;
  }
  .select-sort-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-bottom: 0.5rem;
    font-size: 0.88rem;
  }
  .select-sort-label {
    font-weight: 600;
    color: #444;
  }
  .select-sort-choice {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }
  .block-item input,
  .block-item select {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    border: 1px solid #bbb;
    border-radius: 6px;
  }
</style>
