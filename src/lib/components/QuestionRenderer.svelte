<script lang="ts">
  import type { RuleAnswer, RuleQuestion } from '$types/rules';

  export let question: RuleQuestion;
  export let value: RuleAnswer;
  export let answers: Record<string, RuleAnswer> = {};
  export let onChange: (value: RuleAnswer) => void;

  // Logical component: dependent option resolution for cascading dropdowns.
  $: parentValue = question.dependsOn ? answers[question.dependsOn] : null;
  $: resolvedOptions =
    question.dependsOn && question.optionsByParent && typeof parentValue === 'string'
      ? question.optionsByParent[parentValue] ?? []
      : (question.options ?? []);

  // Logical component: strongly-typed input event handlers.
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
</script>

<section>
  <h2>{question.prompt}</h2>
  {#if question.helpText}
    <p>{question.helpText}</p>
  {/if}

  {#if question.answerType === 'boolean'}
    <!-- Logical component: boolean answer input -->
    <label>
      <input
        type="checkbox"
        checked={Boolean(value)}
        on:change={handleBooleanChange}
      />
      Yes
    </label>
  {:else if question.answerType === 'number'}
    <!-- Logical component: numeric answer input -->
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
    <!-- Logical component: select-list answer input -->
    <select value={typeof value === 'string' ? value : ''} on:change={handleSelectChange} disabled={Boolean(question.dependsOn) && resolvedOptions.length === 0}>
      <option value="">Select an option</option>
      {#each resolvedOptions as option}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  {:else}
    <!-- Logical component: text answer input -->
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

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; min-width: 0; }
  input, select { width: 100%; max-width: 100%; box-sizing: border-box; padding: 0.6rem; border: 1px solid #bbb; border-radius: 6px; }
</style>
