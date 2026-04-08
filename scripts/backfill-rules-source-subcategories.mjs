// Logical component: add / refresh subcategory on rules-source category JSON (checkbox + legacy sheets).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSubcategory } from './assign-subcategory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'rules-source');
const files = ['engine', 'drivetrain', 'suspension', 'brakes', 'exterior', 'vehicles', 'tires', 'weight'];

for (const id of files) {
  const filePath = path.join(sourceDir, `${id}.json`);
  if (!fs.existsSync(filePath)) continue;
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!doc.category?.questions) continue;
  doc.category.questions = doc.category.questions.map((q) => ({
    ...q,
    subcategory: assignSubcategory(doc.category.id, q.prompt)
  }));
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`Updated subcategories: ${id}.json`);
}
