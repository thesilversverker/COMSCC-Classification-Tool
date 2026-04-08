<script lang="ts">
  import QuestionRenderer from '$components/QuestionRenderer.svelte';
  import { findShowroomCatalogMatch } from '$lib/vehicles-showroom-match';
  import type { ShowroomLookupRow } from '$lib/vehicles-showroom-match';
  import type { RuleAnswer, RuleQuestion } from '$types/rules';

  // Logical component: open-vehicle-db row shape (see https://github.com/plowman/open-vehicle-db).
  type OpenDbModel = {
    model_id: number;
    model_name: string;
    model_styles: Record<string, { years?: number[] } & Record<string, unknown>>;
    vehicle_type: string;
    years: number[];
  };

  type OpenDbMake = {
    make_slug: string;
    make_name: string;
    models: Record<string, OpenDbModel>;
    first_year: number;
    last_year: number;
  };

  type TrimOption = { id: string; label: string; years: number[] };

  export let openMakesModels: OpenDbMake[] = [];
  export let showroomRows: ShowroomLookupRow[] = [];
  export let answers: Record<string, RuleAnswer> = {};
  export let onAnswer: (questionId: string, value: RuleAnswer) => void;

  // Logical component: manual showroom points question (needsManualPoints when catalog has no assessment).
  const manualShowroomQuestion: RuleQuestion = {
    id: 'vehicles_showroom_manual_points',
    prompt: 'Showroom Assessment points (manual)',
    subcategory: 'Vehicle',
    answerType: 'number',
    sheetName: 'Vehicles',
    needsManualPoints: true,
    helpText:
      'Enter the Showroom Assessment from the COMSCC workbook when your selection is not in the catalog or the catalog row has no numeric assessment.'
  };

  // Logical component: trim dropdown only when open-vehicle-db exposes model_styles entries.
  function trimOptionsFromStyles(model: OpenDbModel | undefined): TrimOption[] {
    if (!model) return [];
    const styles = model.model_styles ?? {};
    const keys = Object.keys(styles);
    if (keys.length === 0) return [];
    return keys.map((k) => {
      const st = styles[k] as { years?: number[] };
      const ys = Array.isArray(st.years) && st.years.length > 0 ? st.years : model.years;
      return { id: k, label: k, years: [...ys].sort((a, b) => b - a) };
    });
  }

  function setVehicleField(id: string, value: RuleAnswer) {
    onAnswer(id, value);
  }

  function clearDownstreamFromMake() {
    setVehicleField('vehicles_model_key', null);
    setVehicleField('vehicles_model_label', null);
    setVehicleField('vehicles_trim_key', null);
    setVehicleField('vehicles_trim_label', null);
    setVehicleField('vehicles_year', null);
  }

  function clearDownstreamFromModel() {
    setVehicleField('vehicles_trim_key', null);
    setVehicleField('vehicles_trim_label', null);
    setVehicleField('vehicles_year', null);
  }

  function clearDownstreamFromTrim() {
    setVehicleField('vehicles_year', null);
  }

  function handleMakeChange(event: Event) {
    const slug = (event.currentTarget as HTMLSelectElement).value;
    if (!slug) {
      setVehicleField('vehicles_make_slug', null);
      setVehicleField('vehicles_make_label', null);
      clearDownstreamFromMake();
      return;
    }
    const mk = openMakesModels.find((m) => m.make_slug === slug);
    setVehicleField('vehicles_make_slug', slug);
    setVehicleField('vehicles_make_label', mk?.make_name ?? slug);
    clearDownstreamFromMake();
  }

  function handleModelChange(event: Event) {
    const key = (event.currentTarget as HTMLSelectElement).value;
    if (!key) {
      setVehicleField('vehicles_model_key', null);
      setVehicleField('vehicles_model_label', null);
      clearDownstreamFromModel();
      return;
    }
    const model = selectedMake?.models[key];
    setVehicleField('vehicles_model_key', key);
    setVehicleField('vehicles_model_label', model?.model_name ?? key);
    setVehicleField('vehicles_trim_key', null);
    setVehicleField('vehicles_trim_label', null);
    setVehicleField('vehicles_year', null);
  }

  function handleTrimChange(event: Event) {
    const trimId = (event.currentTarget as HTMLSelectElement).value;
    if (!trimId) {
      setVehicleField('vehicles_trim_key', null);
      setVehicleField('vehicles_trim_label', null);
      clearDownstreamFromTrim();
      return;
    }
    const opt = trimOptions.find((t) => t.id === trimId);
    setVehicleField('vehicles_trim_key', trimId);
    setVehicleField('vehicles_trim_label', opt?.label ?? trimId);
    clearDownstreamFromTrim();
  }

  function handleYearChange(event: Event) {
    const y = (event.currentTarget as HTMLSelectElement).value;
    setVehicleField('vehicles_year', y === '' ? null : y);
  }

  $: sortedMakes = [...openMakesModels].sort((a, b) => a.make_name.localeCompare(b.make_name));
  $: makeSlug = typeof answers.vehicles_make_slug === 'string' ? answers.vehicles_make_slug : '';
  $: selectedMake = openMakesModels.find((m) => m.make_slug === makeSlug);
  $: modelEntries = selectedMake
    ? Object.entries(selectedMake.models).sort((a, b) =>
        a[1].model_name.localeCompare(b[1].model_name)
      )
    : [];
  $: modelKey = typeof answers.vehicles_model_key === 'string' ? answers.vehicles_model_key : '';
  $: selectedModel = selectedMake?.models[modelKey];
  $: modelHasStyles =
    Boolean(selectedModel) && Object.keys(selectedModel?.model_styles ?? {}).length > 0;
  $: trimOptions = modelHasStyles ? trimOptionsFromStyles(selectedModel) : [];
  $: trimKey = typeof answers.vehicles_trim_key === 'string' ? answers.vehicles_trim_key : '';
  $: yearOptions = modelHasStyles
    ? trimOptions.find((t) => t.id === trimKey)?.years ?? []
    : selectedModel
      ? [...selectedModel.years].sort((a, b) => b - a)
      : [];

  $: catalogHit = findShowroomCatalogMatch(answers, showroomRows);
  $: hasNumericAssessment =
    catalogHit !== null &&
    typeof catalogHit.showroomAssessment === 'number' &&
    Number.isFinite(catalogHit.showroomAssessment);
  $: selectionComplete =
    Boolean(makeSlug && modelKey) &&
    (!modelHasStyles || Boolean(trimKey)) &&
    typeof answers.vehicles_year === 'string' &&
    answers.vehicles_year.length === 4;
  $: showManualShowroom =
    (selectionComplete && !hasNumericAssessment) ||
    (catalogHit !== null && !hasNumericAssessment);
</script>

<section class="vehicles-picker" aria-label="Vehicle selection">
  <h3 class="picker-title">Vehicle selection</h3>
  <p class="picker-flow">Make → Model → Year; <strong>Trim</strong> appears only when the database lists styles for that model.</p>
  <p class="picker-source">
    Make / model / year data from
    <a href="https://github.com/plowman/open-vehicle-db" rel="noreferrer" target="_blank">open-vehicle-db</a>
    (makes_and_models.json). Showroom Assessment points match the COMSCC workbook catalog when available.
  </p>

  <div class="picker-grid">
    <label class="field">
      <span>Make</span>
      <select value={makeSlug} on:change={handleMakeChange}>
        <option value="">Select make</option>
        {#each sortedMakes as mk (mk.make_slug)}
          <option value={mk.make_slug}>{mk.make_name}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Model</span>
      <select value={modelKey} on:change={handleModelChange} disabled={!selectedMake}>
        <option value="">Select model</option>
        {#each modelEntries as [key, mo] (key)}
          <option value={key}>{mo.model_name}</option>
        {/each}
      </select>
    </label>

    {#if modelHasStyles}
      <label class="field">
        <span>Trim</span>
        <select value={trimKey} on:change={handleTrimChange} disabled={!selectedModel}>
          <option value="">Select trim</option>
          {#each trimOptions as t (t.id)}
            <option value={t.id}>{t.label}</option>
          {/each}
        </select>
      </label>
    {/if}

    <label class="field">
      <span>Year</span>
      <select
        value={typeof answers.vehicles_year === 'string' ? answers.vehicles_year : ''}
        on:change={handleYearChange}
        disabled={!selectedModel || (modelHasStyles && !trimKey) || yearOptions.length === 0}
      >
        <option value="">Select year</option>
        {#each yearOptions as y (y)}
          <option value={String(y)}>{y}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if catalogHit}
    <div class="catalog-status" class:has-points={hasNumericAssessment}>
      {#if hasNumericAssessment}
        <p>
          <strong>COMSCC catalog match:</strong>
          {catalogHit.showroomAssessment?.toFixed(3)} showroom assessment pts (row {catalogHit.catalogId}).
          {#if catalogHit.baseClassification}
            <span class="base-class">Base class {catalogHit.baseClassification}</span>
          {/if}
        </p>
      {:else}
        <p>
          {#if catalogHit.comsccEnriched === false}
            <strong>Vehicle in open-vehicle-db.</strong> COMSCC workbook seed has no matching showroom row — enter
            Showroom Assessment manually below.
          {:else}
            <strong>COMSCC seed row</strong>
            (row {catalogHit.catalogId}) has no numeric Showroom Assessment — enter points manually below.
          {/if}
        </p>
      {/if}
    </div>
  {:else if makeSlug && modelKey && (!modelHasStyles || trimKey) && answers.vehicles_year}
    <p class="catalog-miss">No COMSCC showroom row for this make, model, and year — use manual Showroom Assessment below.</p>
  {/if}

  {#if showManualShowroom}
    <div class="manual-wrap">
      <QuestionRenderer
        question={manualShowroomQuestion}
        value={answers.vehicles_showroom_manual_points ?? null}
        manualValue={null}
        {answers}
        onChange={(v) => onAnswer('vehicles_showroom_manual_points', v)}
        onManualChange={undefined}
      />
    </div>
  {/if}
</section>

<style>
  .vehicles-picker {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 0.75rem 1rem;
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    background: #fff;
  }
  .picker-title {
    margin: 0;
    font-size: 1rem;
  }
  .picker-flow {
    margin: 0;
    font-size: 0.85rem;
    color: #444;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .picker-source {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.4;
    color: #555;
    overflow-wrap: anywhere;
  }
  .picker-source a {
    color: #3a5bc7;
  }
  .picker-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  }
  .field {
    display: grid;
    gap: 0.3rem;
    font-size: 0.88rem;
    min-width: 0;
  }
  .field span {
    color: #444;
  }
  .field select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.45rem;
    border: 1px solid #bbb;
    border-radius: 6px;
    background: #fff;
  }
  .catalog-status {
    margin: 0;
    padding: 0.5rem 0.65rem;
    border-radius: 6px;
    background: #fff8e6;
    border: 1px solid #f0e0b2;
    font-size: 0.9rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .catalog-status.has-points {
    background: #eef6ee;
    border-color: #c5dcc5;
  }
  .catalog-status p {
    margin: 0;
  }
  .base-class {
    display: inline-block;
    margin-left: 0.35rem;
    font-weight: 600;
  }
  .catalog-miss {
    margin: 0;
    font-size: 0.88rem;
    color: #664;
    overflow-wrap: anywhere;
  }
  .manual-wrap :global(.block-item) {
    margin-top: 0;
  }
</style>
