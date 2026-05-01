import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeComsccDerivedFields } from './comscc-derived-fields.mjs';
import { mergeStylesDirectoryIntoMakes } from './open-vehicle-merge.mjs';
import { flattenOpenDb, pickComsccRow, slugify } from './build-showroom-lookup-rows.mjs';
import { baseClassificationFromShowroomAssessment } from './touring-tier-from-points.mjs';
import { readJson, writeJson } from './json-io.mjs';

// Logical component: rules-source/open-vehicle/makes_and_models.json + styles/{make_slug}.json + vehicles-comscc-catalog.json → rules-source/vehicles.json (committed).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MAKES_PATH = path.join(repoRoot, 'rules-source', 'open-vehicle', 'makes_and_models.json');
const STYLES_DIR = path.join(repoRoot, 'rules-source', 'open-vehicle', 'styles');
const COMSCC_CATALOG_PATH = path.join(repoRoot, 'rules-source', 'vehicles-comscc-catalog.json');
const VEHICLES_JSON_PATH = path.join(repoRoot, 'rules-source', 'vehicles.json');

function numOrNull(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** @param {Record<string, unknown> | null | undefined} o */
function workbookRowToCatalogFields(o) {
  if (!o) return null;
  return {
    showroomBaseWeightLbs: numOrNull(o.showroomBaseWeightLbs),
    factoryRatedHp: numOrNull(o.factoryRatedHp),
    factoryRatedTorqueLbFt: numOrNull(o.factoryRatedTorqueLbFt),
    powerBlend: numOrNull(o.powerBlend),
    weightPerPower: numOrNull(o.weightPerPower),
    scaledWeightPerPower: numOrNull(o.scaledWeightPerPower),
    suspIndex: numOrNull(o.suspIndex),
    performanceAdjustment: numOrNull(o.performanceAdjustment),
    showroomAssessment: numOrNull(o.showroomAssessment)
  };
}

/**
 * Merge template + optional override scalars (override wins when numeric/string set).
 * @param {Record<string, unknown>} template
 * @param {Record<string, unknown> | null} override
 */
function mergeScalarsForTemplate(template, override) {
  const t = template ?? {};
  const o = override ?? {};
  const keys = ['showroomBaseWeightLbs', 'factoryRatedHp', 'factoryRatedTorqueLbFt', 'suspIndex'];
  /** @type {Record<string, unknown>} */
  const out = { ...t };
  for (const k of keys) {
    if (typeof o[k] === 'number' && Number.isFinite(o[k])) {
      out[k] = o[k];
    }
  }
  return out;
}

/** @param {Record<string, unknown>} flatRow */
function buildCatalogRow(flatRow, comsccTemplate, overrideRows) {
  const override = pickComsccRow(
    flatRow.makeName,
    flatRow.modelName,
    flatRow.year,
    overrideRows,
    flatRow.trimKey
  );

  const trimPart = flatRow.trimKey ? `_${slugify(flatRow.trimKey)}` : '';
  const id = `ov_${slugify(flatRow.makeSlug)}_${slugify(flatRow.modelKey)}_${flatRow.year}${trimPart}`;

  const openFields = {
    id,
    makeSlug: flatRow.makeSlug,
    makeName: flatRow.makeName,
    modelKey: flatRow.modelKey,
    modelName: flatRow.modelName,
    year: flatRow.year,
    trimKey: flatRow.trimKey,
    trimLabel: flatRow.trimLabel,
    make: flatRow.makeName,
    model: flatRow.modelName,
    startYear: flatRow.year,
    endYear: flatRow.year
  };

  // Logical component: full workbook row — use extracted numbers as-is (no JS recompute).
  if (
    override &&
    typeof override.showroomAssessment === 'number' &&
    Number.isFinite(override.showroomAssessment)
  ) {
    const w = workbookRowToCatalogFields(override);
    return {
      ...openFields,
      comsccMatched: true,
      comsccCatalogId: typeof override.id === 'string' ? override.id : null,
      make: typeof override.make === 'string' ? override.make : openFields.make,
      model: typeof override.model === 'string' ? override.model : openFields.model,
      ...w,
      baseClassification: baseClassificationFromShowroomAssessment(w.showroomAssessment)
    };
  }

  const mergedScalars = mergeScalarsForTemplate(comsccTemplate, override);
  const derived = computeComsccDerivedFields(mergedScalars);

  return {
    ...openFields,
    comsccMatched: Boolean(override),
    comsccCatalogId: override && typeof override.id === 'string' ? override.id : null,
    showroomBaseWeightLbs: numOrNull(mergedScalars.showroomBaseWeightLbs),
    factoryRatedHp: numOrNull(mergedScalars.factoryRatedHp),
    factoryRatedTorqueLbFt: numOrNull(mergedScalars.factoryRatedTorqueLbFt),
    suspIndex: numOrNull(mergedScalars.suspIndex),
    powerBlend: derived.powerBlend,
    weightPerPower: derived.weightPerPower,
    scaledWeightPerPower: derived.scaledWeightPerPower,
    performanceAdjustment: derived.performanceAdjustment,
    showroomAssessment: derived.showroomAssessment,
    baseClassification: baseClassificationFromShowroomAssessment(derived.showroomAssessment)
  };
}

function compose() {
  if (!fs.existsSync(MAKES_PATH)) {
    throw new Error(`Missing makes_and_models.json: ${MAKES_PATH}`);
  }
  if (!fs.existsSync(COMSCC_CATALOG_PATH)) {
    throw new Error(`Missing COMSCC catalog: ${COMSCC_CATALOG_PATH}`);
  }
  if (!fs.existsSync(VEHICLES_JSON_PATH)) {
    throw new Error(`Missing vehicles category shell: ${VEHICLES_JSON_PATH}`);
  }

  const vehiclesShell = readJson(VEHICLES_JSON_PATH);
  const cat = vehiclesShell.category;
  if (!cat || cat.id !== 'vehicles') {
    throw new Error('rules-source/vehicles.json must contain category.id "vehicles"');
  }

  const openDb = readJson(MAKES_PATH);
  const merged = mergeStylesDirectoryIntoMakes(openDb, STYLES_DIR);
  const flat = flattenOpenDb(merged);

  const comsccDoc = readJson(COMSCC_CATALOG_PATH);
  const comsccTemplate = comsccDoc.comsccTemplate;
  if (typeof comsccTemplate !== 'object' || comsccTemplate === null) {
    throw new Error('vehicles-comscc-catalog.json must contain object comsccTemplate');
  }
  const overrideRows = Array.isArray(comsccDoc.vehicleCatalog) ? comsccDoc.vehicleCatalog : [];

  const vehicleCatalog = flat.map((row) => buildCatalogRow(row, comsccTemplate, overrideRows));

  const outDoc = {
    schemaVersion: '1.0.0',
    category: {
      id: cat.id,
      label: cat.label,
      description: cat.description,
      questions: cat.questions ?? [],
      vehicleCatalog
    }
  };

  writeJson(VEHICLES_JSON_PATH, outDoc);
  console.log(
    `Wrote ${VEHICLES_JSON_PATH} (${vehicleCatalog.length} rows; ${overrideRows.length} COMSCC workbook overrides in catalog)`
  );
}

compose();
