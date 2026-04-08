<script lang="ts">
  import type { RuleAnswer, RuleQuestion } from '$types/rules';

  export let question: RuleQuestion;
  export let value: RuleAnswer;
  export let onChange: (value: RuleAnswer) => void;

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
    onChange((event.currentTarget as HTMLInputElement).value);
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
      on:input={handleNumberChange}
    />
  {:else if question.answerType === 'select'}
    <!-- Logical component: select-list answer input -->
    <select value={typeof value === 'string' ? value : ''} on:change={handleSelectChange}>
      <option value="">Select an option</option>
      {#each question.options ?? [] as option}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  {:else}
    <!-- Logical component: text answer input -->
    <input
      type="text"
      value={typeof value === 'string' ? value : ''}
      on:input={handleTextChange}
    />
  {/if}
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
  input, select { width: 100%; padding: 0.6rem; border: 1px solid #bbb; border-radius: 6px; }
</style>
