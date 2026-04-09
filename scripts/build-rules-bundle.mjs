import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSubcategory } from './assign-subcategory.mjs';
import { buildShowroomLookupRowsFromVehicleCatalog } from './build-showroom-lookup-rows.mjs';

// Logical component: rules-source (vehicles.json with composed catalog) + preset + categories → src/lib/data (never writes rules-source except via compose script).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const PRESET_PATH = path.join(repoRoot, 'src/lib/data/presets/vehicles-tires-weight.json');
const SOURCE_DIR = path.join(repoRoot, 'rules-source');
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

function writeVehicleShowroomLookup(vehicleCatalog) {
  const comsccDoc = fs.existsSync(COMSCC_CATALOG_PATH) ? readJson(COMSCC_CATALOG_PATH) : {};
  const overrideRowCount = Array.isArray(comsccDoc.vehicleCatalog) ? comsccDoc.vehicleCatalog.length : 0;

  const { rows, mergedCount, flatCount, comsccSeedCount } = buildShowroomLookupRowsFromVehicleCatalog(
    vehicleCatalog,
    { overrideRowCount }
  );

  writeJson(OUTPUT_SHOWROOM_LOOKUP, {
    schemaVersion: '1.2.0',
    generatedAt: new Date().toISOString(),
    vehiclesSourcePath: 'rules-source/vehicles.json',
    comsccCatalogPath: 'rules-source/vehicles-comscc-catalog.json',
    sourceWorkbook: comsccDoc.sourceWorkbook ?? 'unknown.xlsx',
    comsccOverrideRowCount: comsccSeedCount,
    openDbRowCount: flatCount,
    comsccWorkbookMatchRowCount: mergedCount,
    rows
  });
  console.log(
    `Wrote ${OUTPUT_SHOWROOM_LOOKUP} (${rows.length} rows; ${mergedCount} workbook-matched, ${comsccSeedCount} catalog overrides)`
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
  const vehicleCatalog = vc.vehicleCatalog;
  if (!Array.isArray(vehicleCatalog) || vehicleCatalog.length === 0) {
    throw new Error(
      'rules-source/vehicles.json must include category.vehicleCatalog (run npm run data:compose-vehicles first)'
    );
  }

  writeVehicleShowroomLookup(vehicleCatalog);

  // Logical component: rules bundle carries UI metadata only — full catalog stays in rules-source/vehicles.json + lookup JSON.
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
