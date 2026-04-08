import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Logical component: compact showroom rows from rules-source/vehicles.json for runtime catalog matching.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const VEHICLES_SOURCE = path.join(repoRoot, 'rules-source', 'vehicles.json');
const OUTPUT = path.join(repoRoot, 'src', 'lib', 'data', 'vehicle-showroom-lookup.json');

function normToken(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function build() {
  if (!fs.existsSync(VEHICLES_SOURCE)) {
    throw new Error(`Missing ${VEHICLES_SOURCE}`);
  }
  const doc = JSON.parse(fs.readFileSync(VEHICLES_SOURCE, 'utf8'));
  const catalog = doc.category?.vehicleCatalog;
  if (!Array.isArray(catalog)) {
    throw new Error('vehicles.json missing category.vehicleCatalog');
  }

  const rows = catalog.map((r) => ({
    makeNorm: normToken(r.make),
    modelNorm: normToken(r.model),
    startYear: typeof r.startYear === 'number' ? r.startYear : null,
    endYear: typeof r.endYear === 'number' ? r.endYear : null,
    showroomAssessment: typeof r.showroomAssessment === 'number' ? r.showroomAssessment : null,
    showroomBaseWeightLbs: typeof r.showroomBaseWeightLbs === 'number' ? r.showroomBaseWeightLbs : null,
    baseClassification: typeof r.baseClassification === 'string' ? r.baseClassification.trim() || null : null,
    catalogId: r.id
  }));

  const bundle = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceWorkbook: doc.sourceWorkbook ?? 'unknown.xlsx',
    rows
  };

  fs.writeFileSync(OUTPUT, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT} (${rows.length} showroom rows)`);
}

build();
