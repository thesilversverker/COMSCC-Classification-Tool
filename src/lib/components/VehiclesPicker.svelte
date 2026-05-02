<script lang="ts">
  import QuestionRenderer from '$components/QuestionRenderer.svelte';
  import { comsccTrimChoicesForYear, type ComsccCatalogSeedRow } from '$lib/comscc-catalog-trims';
  import { isVehicleSelectionComplete } from '$lib/vehicles-showroom-match';
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

  export let openMakesModels: OpenDbMake[] = [];
  export let comsccVehicleCatalog: ComsccCatalogSeedRow[] = [];
  /** Resolved via compose lookup + COMSCC seed fallback (see comscc-seed-showroom.ts). */
  export let catalogHit: ShowroomLookupRow | null = null;
  export let answers: Record<string, RuleAnswer> = {};
  export let onAnswer: (questionId: string, value: RuleAnswer) => void;

  // Logical component: manual showroom points question (needsManualPoints when catalog has no assessment).
  const manualShowroomQuestion: RuleQuestion = {
    id: 'vehicles_showroom_manual_points',
    prompt: 'Showroom Assessment points (manual)',
    subcategory: 'Vehicle',
    answerType: 'number',
    needsManualPoints: true,
    helpText:
      'Enter the Showroom Assessment from the COMSCC workbook when your selection is not in the catalog or the catalog row has no numeric assessment.'
  };

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
    clearDownstreamFromModel();
  }

  function handleYearChange(event: Event) {
    const y = (event.currentTarget as HTMLSelectElement).value;
    const yearStr = y === '' ? null : y;
    setVehicleField('vehicles_year', yearStr);
    const makeL = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label : '';
    const modelL = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label : '';
    if (yearStr && yearStr.length === 4 && makeL && modelL) {
      const yr = Number(yearStr);
      const nextChoices = comsccTrimChoicesForYear(comsccVehicleCatalog, makeL, modelL, yr);
      if (nextChoices.length > 0) {
        setVehicleField('vehicles_trim_key', '');
        setVehicleField('vehicles_trim_label', null);
      } else {
        setVehicleField('vehicles_trim_key', null);
        setVehicleField('vehicles_trim_label', null);
      }
    } else {
      setVehicleField('vehicles_trim_key', null);
      setVehicleField('vehicles_trim_label', null);
    }
  }

  function handleTrimChange(event: Event) {
    const trimId = (event.currentTarget as HTMLSelectElement).value;
    if (trimId === '') {
      setVehicleField('vehicles_trim_key', '');
      setVehicleField('vehicles_trim_label', null);
      return;
    }
    const opt = comsccTrimChoices.find((t) => t.id === trimId);
    setVehicleField('vehicles_trim_key', trimId);
    setVehicleField('vehicles_trim_label', opt?.label ?? trimId);
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
  $: yearStr = typeof answers.vehicles_year === 'string' ? answers.vehicles_year.trim() : '';
  $: selectedYear = yearStr.length === 4 ? Number(yearStr) : NaN;
  $: makeLabelUi = typeof answers.vehicles_make_label === 'string' ? answers.vehicles_make_label : '';
  $: modelLabelUi = typeof answers.vehicles_model_label === 'string' ? answers.vehicles_model_label : '';
  $: comsccTrimChoices =
    makeLabelUi && modelLabelUi && Number.isInteger(selectedYear)
      ? comsccTrimChoicesForYear(comsccVehicleCatalog, makeLabelUi, modelLabelUi, selectedYear)
      : [];
  $: showTrimStep = comsccTrimChoices.length > 0;
  $: yearOptions = selectedModel ? [...selectedModel.years].sort((a, b) => b - a) : [];
  $: trimSelectValue =
    typeof answers.vehicles_trim_key === 'string' ? answers.vehicles_trim_key : '';

  $: hasNumericAssessment =
    catalogHit !== null &&
    typeof catalogHit.showroomAssessment === 'number' &&
    Number.isFinite(catalogHit.showroomAssessment);
  // Logical component: green “catalog match” — composed lookup enrichment or COMSCC seed fallback.
  $: isComsccEvaluatedMatch =
    hasNumericAssessment &&
    (catalogHit?.comsccEnriched === true || catalogHit?.showroomSource === 'comscc_seed');
  $: isUnevaluatedNumericMatch =
    hasNumericAssessment &&
    catalogHit?.comsccEnriched !== true &&
    catalogHit?.showroomSource !== 'comscc_seed';
  $: selectionComplete = isVehicleSelectionComplete(answers, comsccVehicleCatalog);
  $: showManualShowroom =
    (selectionComplete && !hasNumericAssessment) ||
    (catalogHit !== null && !hasNumericAssessment);
</script>

<section class="vehicles-picker" aria-label="Vehicle selection">
  <h3 class="picker-title">Vehicle selection</h3>
  <p class="picker-flow">
    Make → Model → Year. <strong>Trim / style</strong> appears only when the COMSCC seed catalog lists named trims for that
    year; otherwise showroom values use the base row for that make, model, and year.
  </p>
  <p class="picker-source">
    Make / model / year data from
    <a href="https://github.com/plowman/open-vehicle-db" rel="noreferrer" target="_blank">open-vehicle-db</a>
    (makes_and_models.json). Named trims in <code>rules-source/vehicles-comscc-catalog.json</code> drive optional trim
    choices and generated <code>open-vehicle/styles/</code> overlays. Showroom Assessment matches the composed catalog when
    available.
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

    <label class="field">
      <span>Year</span>
      <select
        value={yearStr}
        on:change={handleYearChange}
        disabled={!selectedModel || yearOptions.length === 0}
      >
        <option value="">Select year</option>
        {#each yearOptions as y (y)}
          <option value={String(y)}>{y}</option>
        {/each}
      </select>
    </label>

    {#if showTrimStep}
      <label class="field">
        <span>Trim / style</span>
        <select
          value={trimSelectValue}
          on:change={handleTrimChange}
          disabled={!selectedModel || yearStr.length !== 4}
        >
          <option value="">Select trim</option>
          {#each comsccTrimChoices as t (t.id)}
            <option value={t.id}>{t.label}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>

  {#if catalogHit}
    <div
      class="catalog-status"
      class:has-points={isComsccEvaluatedMatch}
      class:unevaluated-numeric={isUnevaluatedNumericMatch}
    >
      {#if isComsccEvaluatedMatch}
        <p>
          <strong>COMSCC catalog match:</strong>
          {catalogHit.showroomAssessment?.toFixed(3)} showroom assessment pts (row {catalogHit.catalogId}).
          {#if catalogHit.showroomSource === 'comscc_seed'}
            <span class="catalog-seed-hint">(seed catalog — open-vehicle trim keys did not match)</span>
          {/if}
          {#if catalogHit.baseClassification}
            <span class="base-class">Base class {catalogHit.baseClassification}</span>
          {/if}
        </p>
      {:else if isUnevaluatedNumericMatch}
        <p>
          <strong>Unevaluated vehicle.</strong>
          This selection is not in the COMSCC workbook seed — showroom numbers may be template defaults (row
          {catalogHit.catalogId}).
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
  {:else if makeSlug && modelKey && yearStr.length === 4 && (!showTrimStep || trimSelectValue !== '')}
    <p class="catalog-miss">No COMSCC showroom row for this make, model, and year.</p>
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
  .catalog-status.unevaluated-numeric {
    background: #fdeaea;
    border-color: #e0a8a8;
    color: #5c2020;
  }
  .catalog-status p {
    margin: 0;
  }
  .base-class {
    display: inline-block;
    margin-left: 0.35rem;
    font-weight: 600;
  }
  .catalog-seed-hint {
    display: inline-block;
    margin-left: 0.35rem;
    font-weight: 400;
    font-size: 0.85em;
    color: #555;
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
