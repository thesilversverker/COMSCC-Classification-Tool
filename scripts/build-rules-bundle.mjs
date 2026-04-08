import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSubcategory } from './assign-subcategory.mjs';

// Logical component: merge preset UI categories with checkbox rules-source categories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const PRESET_PATH = path.join(repoRoot, 'src/lib/data/presets/vehicles-tires-weight.json');
const SOURCE_DIR = path.join(repoRoot, 'rules-source');
const OUTPUT_PATH = path.join(repoRoot, 'src/lib/data/rules.v1.json');

const CHECKBOX_CATEGORY_FILES = ['engine', 'drivetrain', 'suspension', 'brakes', 'exterior'];
const PRESET_ORDER = ['vehicles', 'weight', 'tires'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Logical component: guarantee subcategory on every question (source files may predate the field).
function withSubcategories(category) {
  return {
    ...category,
    questions: category.questions.map((q) => ({
      ...q,
      subcategory: q.subcategory ?? assignSubcategory(category.id, q.prompt)
    }))
  };
}

function buildBundle() {
  const preset = readJson(PRESET_PATH);
  const presetMap = Object.fromEntries(preset.categories.map((c) => [c.id, c]));

  const categories = [];

  const vehicles = withSubcategories(presetMap.vehicles);
  if (!vehicles) throw new Error('Preset missing vehicles category');
  categories.push(vehicles);

  for (const id of CHECKBOX_CATEGORY_FILES) {
    const filePath = path.join(SOURCE_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing rules-source file: ${filePath}`);
    }
    const doc = readJson(filePath);
    categories.push(withSubcategories(doc.category));
  }

  for (const id of PRESET_ORDER) {
    if (id === 'vehicles') continue;
    const cat = presetMap[id];
    if (!cat) throw new Error(`Preset missing category: ${id}`);
    categories.push(withSubcategories(cat));
  }

  const sourceWorkbook =
    readJson(path.join(SOURCE_DIR, 'index.json')).sourceWorkbook ?? 'unknown.xlsx';

  const bundle = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceWorkbook,
    categories
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH} (${categories.length} categories)`);
}

buildBundle();
