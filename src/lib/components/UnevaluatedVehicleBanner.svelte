<script lang="ts">
  // Logical component: global notice when the selected vehicle has no COMSCC seed row (template-only defaults).

  export let visible = false;

  const CONTACT_EMAIL = 'rules@totallyrealemail.com';
</script>

{#if visible}
  <div class="unevaluated-vehicle-banner" role="status" aria-live="polite">
    <p class="unevaluated-vehicle-copy">
      <strong>Unevaluated vehicle.</strong>
      Your vehicle has not been evaluated yet. Please reach out to
      <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>
      to request classification.
    </p>
  </div>
{/if}

<style>
  .unevaluated-vehicle-banner {
    margin: 0 0 0.75rem;
    padding: 0.65rem 0.85rem;
    border: 1px solid #e2c46d;
    border-radius: 8px;
    background: linear-gradient(180deg, #fffbeb 0%, #fffdf7 100%);
  }
  .unevaluated-vehicle-copy {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #3d3319;
    overflow-wrap: anywhere;
  }
  .unevaluated-vehicle-copy a {
    color: #2d4a8c;
    font-weight: 600;
  }
</style>
