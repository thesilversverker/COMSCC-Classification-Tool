#!/usr/bin/env node
/**
 * Logical component: resolve Python for data-source tooling — prefer committed venv,
 * else COMSCC_PYTHON, else python3 on PATH (see data-source/README one-time setup).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const venvPython = join(root, 'data-source', '.venv', 'bin', 'python');

function resolvePython() {
  if (process.env.COMSCC_PYTHON) return process.env.COMSCC_PYTHON;
  if (existsSync(venvPython)) return venvPython;
  return 'python3';
}

const py = resolvePython();
const args = process.argv.slice(2);
const result = spawnSync(py, args, {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});
process.exit(result.status === null ? 1 : result.status);
