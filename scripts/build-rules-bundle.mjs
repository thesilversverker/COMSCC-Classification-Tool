import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSubcategory } from './assign-subcategory.mjs';
import { buildShowroomLookupRows } from './build-showroom-lookup-rows.mjs';

// Logical component: production data build — open-vehicle-db JSON + rules-source COMSCC seed + category JSON → src/lib/data only (never writes rules-source).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const PRESET_PATH = path.join(repoRoot, 'src/lib/data/presets/vehicles-tires-weight.json');
const SOURCE_DIR = path.join(repoRoot, 'rules-source');
const OPEN_VEHICLE_DB_PATH = path.join(repoRoot, 'src', 'lib', 'data', 'open-vehicle-makes-models.json');
const COMSCC_CATALOG_PATH = path.join(SOURCE_DIR, 'vehicles-comscc-catalog.json');
const OUTPUT_RULES = path.join(repoRoot, 'src', 'lib', 'data', 'rules.v1.json');
const OUTPUT_SHOWROOM_LOOKUP = path.join(repoRoot, 'src', 'lib', 'data', 'vehicle-showroom-lookup.json');

const CHECKBOX_CATEGORY_FILES = ['engine', 'drivetrain', 'suspension', 'brakes', 'exterior'];
const PRESET_CATEGORY_ORDER = ['weight', 'tires'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// Logical component: guarantee subcategory on every question (source files may predate the field).
function withSubcategories(category) {
  return {
    ...category,
    questions: (category.questions ?? []).map((q) => ({
      ...q,
      subcategory: q.subcategory ?? assignSubcategory(category.id, q.prompt)
    }))
  };
}

function writeVehicleShowroomLookup() {
  if (!fs.existsSync(OPEN_VEHICLE_DB_PATH)) {
    throw new Error(`Missing open-vehicle-db snapshot: ${OPEN_VEHICLE_DB_PATH}`);
  }
  if (!fs.existsSync(COMSCC_CATALOG_PATH)) {
    throw new Error(`Missing COMSCC seed (run data:extract-source or commit vehicles-comscc-catalog.json): ${COMSCC_CATALOG_PATH}`);
  }

  const openDb = readJson(OPEN_VEHICLE_DB_PATH);
  const comsccDoc = readJson(COMSCC_CATALOG_PATH);
  const { rows, mergedCount, flatCount, comsccSeedCount } = buildShowroomLookupRows(openDb, comsccDoc);

  writeJson(OUTPUT_SHOWROOM_LOOKUP, {
    schemaVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    openVehicleDbPath: 'src/lib/data/open-vehicle-makes-models.json',
    comsccSeedPath: 'rules-source/vehicles-comscc-catalog.json',
    sourceWorkbook: comsccDoc.sourceWorkbook ?? 'unknown.xlsx',
    comsccSeedRowCount: comsccSeedCount,
    openDbRowCount: flatCount,
    comsccEnrichedRowCount: mergedCount,
    rows
  });
  console.log(
    `Wrote ${OUTPUT_SHOWROOM_LOOKUP} (${rows.length} rows; ${mergedCount}/${flatCount} COMSCC-enriched, ${comsccSeedCount} seed rows)`
  );
}

function buildBundle() {
  const preset = readJson(PRESET_PATH);
  const presetMap = Object.fromEntries(preset.categories.map((c) => [c.id, c]));

  const vehiclesPath = path.join(SOURCE_DIR, 'vehicles.json');
  if (!fs.existsSync(vehiclesPath)) {
    throw new Error(`Missing rules-source file: ${vehiclesPath}`);
  }
  const vehiclesDoc = readJson(vehiclesPath);
  const vc = vehiclesDoc.category;
  if (!vc || vc.id !== 'vehicles') {
    throw new Error('rules-source/vehicles.json must contain category.id "vehicles"');
  }
  if (vc.vehicleCatalog) {
    throw new Error(
      'rules-source/vehicles.json must not embed vehicleCatalog; showroom rows are built from open-vehicle-db + vehicles-comscc-catalog.json at data:build.'
    );
  }

  writeVehicleShowroomLookup();

  const vehiclesForBundle = withSubcategories({
    id: vc.id,
    label: vc.label,
    sheetName: vc.sheetName,
    description: vc.description,
    questions: vc.questions ?? []
  });

  const categories = [vehiclesForBundle];

  for (const id of CHECKBOX_CATEGORY_FILES) {
    const filePath = path.join(SOURCE_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing rules-source file: ${filePath}`);
    }
    const doc = readJson(filePath);
    categories.push(withSubcategories(doc.category));
  }

  for (const id of PRESET_CATEGORY_ORDER) {
    const cat = presetMap[id];
    if (!cat) throw new Error(`Preset missing category: ${id}`);
    categories.push(withSubcategories(cat));
  }

  const sourceWorkbook =
    readJson(path.join(SOURCE_DIR, 'index.json')).sourceWorkbook ?? 'unknown.xlsx';

  writeJson(OUTPUT_RULES, {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceWorkbook,
    categories
  });
  console.log(`Wrote ${OUTPUT_RULES} (${categories.length} categories)`);
}

buildBundle();
