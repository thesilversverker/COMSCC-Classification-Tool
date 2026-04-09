<script lang="ts">
  import type { RuleAnswer, RuleQuestion } from '$types/rules';

  export let question: RuleQuestion;
  export let value: RuleAnswer;
  export let answers: Record<string, RuleAnswer> = {};
  /** Logical component: optional manual points when workbook assessment is unclear (e.g. Dyno). */
  export let manualValue: RuleAnswer = null;
  export let onChange: (value: RuleAnswer) => void;
  export let onManualChange: ((value: RuleAnswer) => void) | undefined = undefined;

  // Logical component: dependent option resolution for cascading dropdowns.
  $: parentValue = question.dependsOn ? answers[question.dependsOn] : null;
  $: resolvedOptions =
    question.dependsOn && question.optionsByParent && typeof parentValue === 'string'
      ? question.optionsByParent[parentValue] ?? []
      : (question.options ?? []);

  function handleBooleanChange(event: Event) {
    onChange((event.currentTarget as HTMLInputElement).checked);
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

  // Logical component: human-readable points suffix for checkbox items.
  $: pointsLabel =
    typeof question.pointValue === 'number'
      ? `(${question.pointValue >= 0 ? '+' : ''}${question.pointValue} pts)`
      : question.needsManualPoints
        ? '(enter points if applicable)'
        : '';

  function toNumberOrNull(v: RuleAnswer): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // Logical component: drivetrain-based dyno loss fraction used by dyno formulas.
  function dynoLossFraction(localAnswers: Record<string, RuleAnswer>): number | null {
    const d = localAnswers.dyno_drivetrain_type;
    if (d === '2wd') return 0.13;
    if (d === 'awd') return 0.16;
    return null;
  }

  function computeScaledPower(localAnswers: Record<string, RuleAnswer>): number | null {
    const hp = toNumberOrNull(localAnswers.dyno_peak_horsepower ?? null);
    const tq = toNumberOrNull(localAnswers.dyno_peak_torque_lbft ?? null);
    const loss = dynoLossFraction(localAnswers);
    if (hp === null || tq === null || loss === null || loss >= 1) return null;
    const denominator = 1 - loss;
    return hp * (2 / 3) * (1 / denominator) + tq * (1 / 3) * (1 / denominator);
  }

  // Logical component: formula display text for dyno-specific computed/info-only questions.
  $: formulaDisplay =
    question.id === 'dyno_loss_percent'
      ? (() => {
          const loss = dynoLossFraction(answers);
          return loss === null ? 'Select drivetrain type to determine loss %.' : `${(loss * 100).toFixed(0)}%`;
        })()
      : question.id === 'scaled_power_formula'
        ? (() => {
            const scaled = computeScaledPower(answers);
            return scaled === null
              ? 'Enter Wheel HP, Peak Torque, and drivetrain type to calculate scaled power.'
              : `${scaled.toFixed(2)}`;
          })()
        : question.prompt;
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
    {#if question.needsManualPoints && Boolean(value) && onManualChange}
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
      <select
        value={typeof value === 'string' ? value : ''}
        on:change={handleSelectChange}
        disabled={Boolean(question.dependsOn) && resolvedOptions.length === 0}
      >
        <option value="">Select an option</option>
        {#each resolvedOptions as option}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
    {:else if question.answerType === 'formula'}
      <p class="manual-assessment-tag formula-readonly">{formulaDisplay}</p>
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
  .manual-points {
    margin: 0.5rem 0 0 1.5rem;
  }
  .manual-points label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .manual-points input {
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
