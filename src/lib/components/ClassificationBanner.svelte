<script lang="ts">
  import { sumCategoryPoints } from '$lib/scoring';
  import {
    modificationPointsRangeLabel,
    specTireWidthMmForTier,
    TIER_DISPLAY_ORDER,
    touringTierFromModificationPoints
  } from '$lib/touring-tiers';
  import type { RuleCategory } from '$types/rules';

  // Logical component: top summary — tier strip (T5–T1), grand modification total, per-category points, spec tire width.
  export let categories: RuleCategory[] = [];
  export let categoryPoints: Record<string, number> = {};
  /** Primary tire width (mm) from the Tires worksheet when entered. */
  export let declaredTireWidthMm: number | null = null;

  $: grandModificationTotal = sumCategoryPoints(categoryPoints);
  $: currentTier = touringTierFromModificationPoints(grandModificationTotal);
  $: specTireWidthMm = specTireWidthMmForTier(currentTier);
</script>

<section class="classification-banner" aria-label="Touring classification summary">
  <div class="banner-head">
    <div class="head-primary">
      <p class="head-line">
        <strong>Total modification points:</strong>
        {grandModificationTotal.toFixed(1)}
      </p>
      <p class="head-line current-class-line">
        <strong>Current class:</strong>
        <span class="current-tier">{currentTier}</span>
      </p>
    </div>
    <div class="head-metrics">
      <p class="head-line">
        <strong>Spec tire width (this class):</strong>
        {specTireWidthMm} mm
      </p>
      {#if declaredTireWidthMm !== null}
        <p class="head-line">
          <strong>Declared primary width:</strong>
          {declaredTireWidthMm} mm
        </p>
      {:else}
        <p class="head-line muted">Enter primary tire width in Tires to compare against spec.</p>
      {/if}
    </div>
  </div>

  <div class="tier-strip" role="list">
    {#each TIER_DISPLAY_ORDER as tier (tier)}
      <!-- Logical component: class:tier-active must reference currentTier here — not inside a helper — or {#each} may not re-run when currentTier changes (stale T5 highlight). -->
      <div class="tier-cell" class:tier-active={tier === currentTier} role="listitem">
        <span class="tier-name">{tier}</span>
        <span class="tier-range">{modificationPointsRangeLabel(tier)} pts</span>
      </div>
    {/each}
  </div>

  <ul class="category-breakdown">
    {#each categories as cat (cat.id)}
      <li>
        <span class="cat-label">{cat.label}</span>
        <span class="cat-points">
          {(categoryPoints[cat.id] ?? 0).toFixed(cat.id === 'weight' ? 3 : 1)} pts
        </span>
      </li>
    {/each}
  </ul>

  <p class="footnote">
    Tier bands apply to the modification subtotal from this tool. Official COMSCC class uses Total Assessment (showroom
    base plus modifications).
  </p>
</section>

<style>
  .classification-banner {
    border: 1px solid #c5cce8;
    border-radius: 10px;
    padding: 1rem 1.1rem;
    background: linear-gradient(180deg, #f4f6ff 0%, #fafbff 100%);
    display: grid;
    gap: 1rem;
    min-width: 0;
  }
  .banner-head {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    align-items: start;
  }
  .head-primary,
  .head-metrics {
    min-width: 0;
    display: grid;
    gap: 0.35rem;
  }
  .head-line {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .current-class-line .current-tier {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0.15rem 0.55rem;
    border-radius: 6px;
    background: #4a6ee0;
    color: #fff;
    font-weight: 700;
  }
  .muted {
    color: #666;
    font-size: 0.9rem;
  }
  .tier-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    min-width: 0;
  }
  .tier-cell {
    flex: 1 1 5.75rem;
    min-width: min(5.75rem, 100%);
    border: 1px solid #d0d5e8;
    border-radius: 8px;
    padding: 0.5rem 0.45rem;
    background: #fff;
    display: grid;
    gap: 0.2rem;
    text-align: center;
    min-width: 0;
  }
  .tier-cell.tier-active {
    border-color: #4a6ee0;
    box-shadow: 0 0 0 2px rgba(74, 110, 224, 0.2);
  }
  .tier-name {
    font-weight: 700;
    font-size: 1rem;
  }
  .tier-range {
    font-size: 0.72rem;
    line-height: 1.35;
    color: #444;
    overflow-wrap: anywhere;
  }
  .category-breakdown {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    min-width: 0;
  }
  .category-breakdown li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid #e2e5f0;
    border-radius: 6px;
    background: #fff;
    font-size: 0.88rem;
    min-width: 0;
  }
  .cat-label {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .cat-points {
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .footnote {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.4;
    color: #666;
    overflow-wrap: anywhere;
  }
</style>
