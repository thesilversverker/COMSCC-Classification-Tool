<script lang="ts">
  // Logical component: sidebar category list with per-category point totals.
  export let categories: { id: string; label: string }[] = [];
  /** Points currently counted for each category id (from session answers). */
  export let categoryPoints: Record<string, number> = {};
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
          <small>{(categoryPoints[category.id] ?? 0).toFixed(category.id === 'weight' ? 3 : 1)} pts</small>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  nav { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; min-width: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  button {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.35rem 0.75rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: white;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  button span,
  button small {
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.35;
  }
  button small { font-variant-numeric: tabular-nums; }
  button.active { border-color: #4a6ee0; background: #eef2ff; }
</style>
