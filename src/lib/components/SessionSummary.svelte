<script lang="ts">
  import type { RulesDocument } from '$types/rules';

  export let rules: RulesDocument;
  export let answers: Record<string, unknown>;
</script>

<section>
  <h2>Session summary</h2>
  <p>
    {Object.values(answers).filter((value) => value !== '' && value !== null && value !== undefined).length}
    answers captured across {rules.categories.length} categories.
  </p>

  <ul>
    {#each rules.categories as category}
      <li>{category.label}: {category.questions.length} questions</li>
    {/each}
  </ul>
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
  ul { margin: 0; padding-left: 1rem; }
</style>
