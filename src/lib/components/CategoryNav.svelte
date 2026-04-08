<script lang="ts">
  export let categories: { id: string; label: string }[] = [];
  export let completion: Record<string, number> = {};
  export let activeCategoryId = '';
  export let onSelect: (index: number) => void;
</script>

<nav aria-label="Category navigation">
  <h2>Categories</h2>
  <ul>
    {#each categories as category, index}
      <li>
        <button
          class:active={category.id === activeCategoryId}
          type="button"
          on:click={() => onSelect(index)}
          aria-current={category.id === activeCategoryId ? 'page' : undefined}
        >
          <span>{category.label}</span>
          <small>{completion[category.id] ?? 0}%</small>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  nav { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  button { width: 100%; display: flex; justify-content: space-between; padding: 0.6rem 0.8rem; border: 1px solid #ddd; border-radius: 6px; background: white; cursor: pointer; }
  button.active { border-color: #4a6ee0; background: #eef2ff; }
</style>
