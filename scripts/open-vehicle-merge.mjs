import fs from 'node:fs';
import path from 'node:path';

// Logical component: overlay plowman/open-vehicle-db data/styles/{make_slug}.json onto makes (model_styles per model key).

/**
 * @param {unknown[]} openDb - makes_and_models.json top-level array (mutated copy returned)
 * @param {string} stylesDir - directory of {make_slug}.json files
 * @returns {unknown[]}
 */
export function mergeStylesDirectoryIntoMakes(openDb, stylesDir) {
  if (!Array.isArray(openDb)) {
    throw new Error('open-vehicle-db must be a top-level array');
  }
  const merged = JSON.parse(JSON.stringify(openDb));

  for (const make of merged) {
    const slug = make?.make_slug;
    if (typeof slug !== 'string' || slug.length === 0) continue;

    const filePath = path.join(stylesDir, `${slug}.json`);
    if (!fs.existsSync(filePath)) continue;

    const stylesByModel = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof stylesByModel !== 'object' || stylesByModel === null) continue;

    const models = make.models ?? {};
    for (const [modelKey, styleMap] of Object.entries(stylesByModel)) {
      if (!models[modelKey] || typeof styleMap !== 'object' || styleMap === null) continue;
      models[modelKey].model_styles = { ...styleMap };
    }
    make.models = models;
  }

  return merged;
}
