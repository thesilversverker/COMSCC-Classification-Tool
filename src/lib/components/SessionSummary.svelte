<script lang="ts">
  import type { SessionSummaryPayload, SessionSummaryRow } from '$lib/session-summary-rows';

  // Logical component: session recap — vehicle, competition weight, scoring lines, final class.
  export let payload: SessionSummaryPayload;

  function formatPoints(row: SessionSummaryRow): string {
    if (row.points === null) return '—';
    const cat = row.categoryId;
    const decimals = cat === 'weight' ? 2 : 1;
    return row.points.toFixed(decimals);
  }
</script>

<section class="session-summary" aria-labelledby="session-summary-heading">
  <h2 id="session-summary-heading">Session summary</h2>

  <dl class="summary-meta">
    <div class="meta-row">
      <dt>Vehicle</dt>
      <dd>{payload.vehicleLine}</dd>
    </div>
    <div class="meta-row">
      <dt>Competition weight</dt>
      <dd>{payload.competitionWeightDisplay}</dd>
    </div>
    <div class="meta-row">
      <dt>Final class</dt>
      <dd><span class="final-class">{payload.finalClass}</span></dd>
    </div>
    <div class="meta-row">
      <dt>Total modification points</dt>
      <dd class="numeric">{payload.grandModificationPoints.toFixed(1)}</dd>
    </div>
  </dl>

  <h3 class="lines-heading">Scoring detail</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Item</th>
          <th scope="col" class="num">Points</th>
        </tr>
      </thead>
      <tbody>
        {#each payload.rows as row, rowIdx (rowIdx)}
          <tr>
            <td>{row.categoryLabel}</td>
            <td>
              {row.label}
              {#if row.detail}
                <span class="detail">{row.detail}</span>
              {/if}
            </td>
            <td class="num">{formatPoints(row)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .session-summary {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 0.75rem;
    min-width: 0;
    font-size: 0.88rem;
  }
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }
  .lines-heading {
    margin: 0.75rem 0 0.35rem;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .summary-meta {
    margin: 0;
    display: grid;
    gap: 0.35rem;
  }
  .meta-row {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: 0.35rem 0.5rem;
    align-items: baseline;
  }
  @media (max-width: 640px) {
    .meta-row {
      grid-template-columns: 1fr;
    }
  }
  .meta-row dt {
    margin: 0;
    font-weight: 600;
    color: #444;
  }
  .meta-row dd {
    margin: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .final-class {
    display: inline-block;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    background: #4a6ee0;
    color: #fff;
    font-weight: 700;
    font-size: 0.9em;
  }
  .numeric {
    font-variant-numeric: tabular-nums;
  }
  .table-wrap {
    overflow-x: auto;
    min-width: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  th,
  td {
    border: 1px solid #e8e8e8;
    padding: 0.35rem 0.45rem;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f6f6f6;
    font-weight: 600;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .detail {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.78rem;
    color: #666;
  }
</style>
