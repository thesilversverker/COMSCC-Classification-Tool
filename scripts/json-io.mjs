// Logical component: shared deterministic JSON writer for all Node build scripts.
// Same input value → byte-identical file output across runs and machines.

import fs from 'node:fs';
import path from 'node:path';

// Logical component: serialization defaults — 2-space indent, trailing newline, no escaping of non-ASCII.
const DEFAULT_INDENT = 2;

/**
 * Reorder object keys for deterministic output. Recursive; arrays preserved as-is.
 * @param {unknown} value
 * @param {((keys: string[]) => string[]) | undefined} keyOrder
 * @returns {unknown}
 */
function withKeyOrder(value, keyOrder) {
  if (!keyOrder) return value;
  if (Array.isArray(value)) return value.map((v) => withKeyOrder(v, keyOrder));
  if (value === null || typeof value !== 'object') return value;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const ordered = keyOrder(Object.keys(obj));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of ordered) out[k] = withKeyOrder(obj[k], keyOrder);
  return out;
}

/**
 * Write JSON to disk deterministically: 2-space indent + trailing newline.
 * Creates parent directories on demand.
 *
 * @param {string} filePath
 * @param {unknown} value
 * @param {{ keyOrder?: (keys: string[]) => string[] }} [options]
 */
export function writeJson(filePath, value, options = {}) {
  const dir = path.dirname(filePath);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ordered = withKeyOrder(value, options.keyOrder);
  fs.writeFileSync(filePath, `${JSON.stringify(ordered, null, DEFAULT_INDENT)}\n`);
}

/**
 * Read and parse a JSON file. Companion to `writeJson` so callers can avoid
 * re-importing `fs` for trivial reads.
 * @param {string} filePath
 * @returns {unknown}
 */
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
