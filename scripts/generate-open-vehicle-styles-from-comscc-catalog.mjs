// Logical component: rules-source/vehicles-comscc-catalog.json named trims → rules-source/open-vehicle/styles/{make_slug}.json for compose/flatten.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CATALOG_PATH = path.join(repoRoot, 'rules-source', 'vehicles-comscc-catalog.json');
const STYLES_DIR = path.join(repoRoot, 'rules-source', 'open-vehicle', 'styles');

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** @param {Record<string, unknown>} row */
function catalogTrim(row) {
  const v = row.vehicleTrim;
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.warn(`Skip style generation: missing ${CATALOG_PATH}`);
    return;
  }
  const doc = readJson(CATALOG_PATH);
  const rows = Array.isArray(doc.vehicleCatalog) ? doc.vehicleCatalog : [];

  /** @type {Map<string, Record<string, Record<string, Set<number>>>>} */
  const byMakeSlug = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const trim = catalogTrim(row);
    if (!trim) continue;
    const make = row.vehicleMake;
    const model = row.vehicleModel;
    if (typeof make !== 'string' || typeof model !== 'string') continue;
    const slug = slugify(make);
    const sy = row.vehicleYearBegin;
    const ey = row.vehicleYearEnd;
    if (typeof sy !== 'number' || typeof ey !== 'number') continue;

    let models = byMakeSlug.get(slug);
    if (!models) {
      models = Object.create(null);
      byMakeSlug.set(slug, models);
    }
    if (!models[model]) models[model] = Object.create(null);
    if (!models[model][trim]) models[model][trim] = new Set();
    for (let y = sy; y <= ey; y++) models[model][trim].add(y);
  }

  for (const [makeSlug, models] of byMakeSlug.entries()) {
    /** @type {Record<string, Record<string, { years: number[] }>>} */
    const out = {};
    for (const [modelKey, trims] of Object.entries(models)) {
      out[modelKey] = {};
      for (const [trimName, yearSet] of Object.entries(trims)) {
        out[modelKey][trimName] = {
          years: [...yearSet].sort((a, b) => a - b)
        };
      }
    }
    const filePath = path.join(STYLES_DIR, `${makeSlug}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`Wrote ${path.relative(repoRoot, filePath)}`);
  }

  if (byMakeSlug.size === 0) {
    console.log('No named vehicleTrim rows in COMSCC catalog — no style JSON files written.');
  }
}

main();
