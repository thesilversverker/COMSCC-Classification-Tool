// Logical component: ajv-based JSON Schema validation for committed rules-source/ vehicle files.
//
// Used by data:compose-vehicles and data:build to fail fast on shape drift, and exposed
// as `npm run data:validate` for curators editing JSON by hand.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { readJson } from './json-io.mjs';

// Logical component: repo paths.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SCHEMAS_DIR = path.join(repoRoot, 'rules-source', '_schemas');
const OPEN_VEHICLE_DIR = path.join(repoRoot, 'rules-source', 'open-vehicle');
const STYLES_DIR = path.join(OPEN_VEHICLE_DIR, 'styles');

// Logical component: schema name → file. Schema files live in rules-source/_schemas/.
const SCHEMA_FILES = {
  makesAndModels: 'makes-and-models.schema.json',
  styles: 'styles.schema.json',
  vehiclesComsccCatalog: 'vehicles-comscc-catalog.schema.json',
  vehicles: 'vehicles.schema.json'
};

// Logical component: lazy ajv singleton with all schemas pre-compiled. Strict mode off because
// our schemas use draft 2020-12 features ajv 8 supports without ajv-formats.
let ajvSingleton = null;
const compiledValidators = new Map();

function getAjv() {
  if (ajvSingleton) return ajvSingleton;
  ajvSingleton = new Ajv2020({ allErrors: true, verbose: true, strict: false });
  for (const [name, file] of Object.entries(SCHEMA_FILES)) {
    const schemaPath = path.join(SCHEMAS_DIR, file);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    compiledValidators.set(name, ajvSingleton.compile(schema));
  }
  return ajvSingleton;
}

/**
 * Format ajv errors into a human-readable, multi-line block keyed by JSON pointer.
 * @param {import('ajv').ErrorObject[] | null | undefined} errors
 * @returns {string}
 */
function formatErrors(errors) {
  if (!errors || errors.length === 0) return '(no error details)';
  return errors
    .slice(0, 10)
    .map((e) => `  - ${e.instancePath || '<root>'} ${e.message ?? ''} ${JSON.stringify(e.params ?? {})}`)
    .join('\n');
}

/**
 * Validate `value` against the named schema. Throws on failure with a labeled error.
 * @param {keyof typeof SCHEMA_FILES} schemaName
 * @param {unknown} value
 * @param {string} contextLabel - human-readable source identifier (file path) for error messages
 */
export function validateOrThrow(schemaName, value, contextLabel) {
  getAjv();
  const validator = compiledValidators.get(schemaName);
  if (!validator) throw new Error(`Unknown schema: ${schemaName}`);
  if (!validator(value)) {
    const details = formatErrors(validator.errors);
    throw new Error(`Schema validation failed for ${contextLabel} (${schemaName}):\n${details}`);
  }
}

/**
 * Validate every per-make styles file in a directory against the styles schema.
 * Throws on the first failure so build scripts fail fast with a clear file path.
 * @param {string} stylesDir
 */
export function validateStylesDirectoryOrThrow(stylesDir) {
  if (!fs.existsSync(stylesDir)) return;
  const files = fs
    .readdirSync(stylesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const f of files) {
    const filePath = path.join(stylesDir, f);
    validateOrThrow('styles', readJson(filePath), path.relative(repoRoot, filePath));
  }
}

/**
 * Validate every committed rules-source vehicle file. Used by `npm run data:validate`.
 * Returns a list of errors instead of throwing so the CLI can summarize.
 * @returns {{ file: string, message: string }[]}
 */
export function validateAllRulesSourceFiles() {
  /** @type {{ file: string, message: string }[]} */
  const failures = [];

  function tryValidate(schemaName, filePath) {
    if (!fs.existsSync(filePath)) {
      failures.push({ file: filePath, message: 'file does not exist' });
      return;
    }
    try {
      const value = readJson(filePath);
      validateOrThrow(schemaName, value, path.relative(repoRoot, filePath));
    } catch (err) {
      failures.push({ file: filePath, message: err instanceof Error ? err.message : String(err) });
    }
  }

  tryValidate('makesAndModels', path.join(OPEN_VEHICLE_DIR, 'makes_and_models.json'));
  tryValidate('vehiclesComsccCatalog', path.join(repoRoot, 'rules-source', 'vehicles-comscc-catalog.json'));
  tryValidate('vehicles', path.join(repoRoot, 'rules-source', 'vehicles.json'));

  // Logical component: every per-make styles file.
  if (fs.existsSync(STYLES_DIR)) {
    const stylesFiles = fs
      .readdirSync(STYLES_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const f of stylesFiles) tryValidate('styles', path.join(STYLES_DIR, f));
  }

  return failures;
}

// Logical component: CLI entry — node scripts/validate-rules-source.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = validateAllRulesSourceFiles();
  if (failures.length === 0) {
    console.log('All rules-source vehicle files validate against their schemas.');
    process.exit(0);
  }
  for (const { file, message } of failures) {
    console.error(`FAIL ${path.relative(repoRoot, file)}\n${message}\n`);
  }
  console.error(`${failures.length} file(s) failed schema validation.`);
  process.exit(1);
}
