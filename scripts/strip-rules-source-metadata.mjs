#!/usr/bin/env node
// Logical component: strip workbook trace keys from rules-source JSON (and preset); run after extract if needed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'rules-source');

/** @param {Record<string, unknown>} q */
function stripQuestion(q) {
  if (!q || typeof q !== 'object') return;
  delete q.sheetName;
  delete q.sourceRef;
}

/** @param {Record<string, unknown>} doc */
function stripCategoryDocument(doc) {
  delete doc.sourceWorkbook;
  delete doc.generatedAt;
  const cat = doc.category;
  if (!cat || typeof cat !== 'object') return;
  delete cat.sheetName;
  const questions = cat.questions;
  if (Array.isArray(questions)) questions.forEach((q) => stripQuestion(/** @type {Record<string, unknown>} */ (q)));
  const dyno = cat.dynoReclassOption;
  if (Array.isArray(dyno)) dyno.forEach((q) => stripQuestion(/** @type {Record<string, unknown>} */ (q)));
  const vc = cat.vehicleCatalog;
  if (Array.isArray(vc)) {
    for (const row of vc) {
      if (row && typeof row === 'object') delete /** @type {Record<string, unknown>} */ (row).sourceRef;
    }
  }
}

/** @param {Record<string, unknown>} doc */
function stripComsccCatalog(doc) {
  delete doc.sourceWorkbook;
  delete doc.generatedAt;
  const t = doc.comsccTemplate;
  if (t && typeof t === 'object') delete /** @type {Record<string, unknown>} */ (t).sourceRef;
  const vc = doc.vehicleCatalog;
  if (Array.isArray(vc)) {
    for (const row of vc) {
      if (row && typeof row === 'object') delete /** @type {Record<string, unknown>} */ (row).sourceRef;
    }
  }
}

/** @param {Record<string, unknown>} doc */
function stripIndex(doc) {
  delete doc.sourceWorkbook;
  delete doc.generatedAt;
}

/** @param {Record<string, unknown>} doc */
function stripPresetDocument(doc) {
  const cats = doc.categories;
  if (!Array.isArray(cats)) return;
  for (const cat of cats) {
    if (!cat || typeof cat !== 'object') continue;
    delete /** @type {Record<string, unknown>} */ (cat).sheetName;
    const questions = /** @type {Record<string, unknown>} */ (cat).questions;
    if (Array.isArray(questions)) questions.forEach((q) => stripQuestion(/** @type {Record<string, unknown>} */ (q)));
  }
}

const categoryFiles = [
  'engine.json',
  'drivetrain.json',
  'suspension.json',
  'brakes.json',
  'exterior.json',
  'tires.json',
  'weight.json',
  'vehicles.json'
];

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  for (const name of categoryFiles) {
    const p = path.join(sourceDir, name);
    if (!fs.existsSync(p)) {
      console.warn(`[skip] missing ${p}`);
      continue;
    }
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    stripCategoryDocument(doc);
    writeJson(p, doc);
    console.log(`Stripped ${path.relative(repoRoot, p)}`);
  }

  const comscc = path.join(sourceDir, 'vehicles-comscc-catalog.json');
  if (fs.existsSync(comscc)) {
    const doc = JSON.parse(fs.readFileSync(comscc, 'utf8'));
    stripComsccCatalog(doc);
    writeJson(comscc, doc);
    console.log(`Stripped ${path.relative(repoRoot, comscc)}`);
  }

  const idx = path.join(sourceDir, 'index.json');
  if (fs.existsSync(idx)) {
    const doc = JSON.parse(fs.readFileSync(idx, 'utf8'));
    stripIndex(doc);
    writeJson(idx, doc);
    console.log(`Stripped ${path.relative(repoRoot, idx)}`);
  }

  const presetPath = path.join(repoRoot, 'src', 'lib', 'data', 'presets', 'vehicles-tires-weight.json');
  if (fs.existsSync(presetPath)) {
    const doc = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
    stripPresetDocument(doc);
    writeJson(presetPath, doc);
    console.log(`Stripped ${path.relative(repoRoot, presetPath)}`);
  }
}

main();
