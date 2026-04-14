// Logical component: rules-source/tires.json (tireCategories + tires[]) → RuleCategory for rules bundle.
// Each tire: { tireName, score, utqg, category } where `category` is tireCategories[].id (e.g. budget_unclassed).

/** @param {string} value */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** @param {unknown} doc @returns {Record<string, unknown>} */
export function buildTiresCategoryFromDoc(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('tires.json: invalid root');
  const tireCategories = /** @type {{ id: string; label: string }[]} */ (
    /** @type {Record<string, unknown>} */ (doc).tireCategories
  );
  const tires = /** @type {{ tireName: string; score: number; utqg: number | null; category: string }[]} */ (
    /** @type {Record<string, unknown>} */ (doc).tires
  );
  const catBlock = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (doc).category ?? {}
  );

  if (!Array.isArray(tireCategories) || tireCategories.length === 0) {
    throw new Error('rules-source/tires.json must include non-empty tireCategories[]');
  }
  if (!Array.isArray(tires) || tires.length === 0) {
    throw new Error('rules-source/tires.json must include non-empty tires[]');
  }

  const catIds = new Set(tireCategories.map((c) => c.id));
  for (const t of tires) {
    if (!t || typeof t !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (t);
    const cat = row.category;
    if (typeof cat !== 'string' || !catIds.has(cat)) {
      throw new Error(
        `Tire "${row.tireName}" references unknown category "${String(cat)}"`
      );
    }
  }

  /** @type {Record<string, { id: string; label: string; points: number; utqg?: number | null }[]>} */
  const optionsByParent = Object.fromEntries(tireCategories.map((c) => [c.id, []]));

  for (const t of tires) {
    const row = /** @type {Record<string, unknown>} */ (t);
    const name = String(row.tireName ?? '');
    const category = String(row.category ?? '');
    const score = Number(row.score);
    if (!Number.isFinite(score)) throw new Error(`Tire "${name}" has invalid score`);
    const utqg = row.utqg;
    const id = `${category}__${slugify(name)}`;
    /** @type {{ id: string; label: string; points: number; utqg?: number | null }} */
    const opt = { id, label: name, points: score };
    if (utqg === null || typeof utqg === 'number') opt.utqg = utqg;
    optionsByParent[category].push(opt);
  }

  // Logical component: stable A–Z order within each internal class bucket (flatten order follows tireCategories).
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  for (const arr of Object.values(optionsByParent)) {
    arr.sort((a, b) => collator.compare(a.label, b.label));
  }

  // Logical component: one flat catalog (class not shown); UI sorts by label or points.
  const flatOptions = tireCategories.flatMap((c) => optionsByParent[c.id] ?? []);
  const seenIds = new Set();
  for (const o of flatOptions) {
    if (seenIds.has(o.id)) {
      throw new Error(`Duplicate tire option id "${o.id}" — fix tires.json (same name in same class?)`);
    }
    seenIds.add(o.id);
  }

  const tail = Array.isArray(catBlock.questions) ? catBlock.questions : [];

  return {
    id: 'tires',
    label: typeof catBlock.label === 'string' ? catBlock.label : 'Tires',
    description: typeof catBlock.description === 'string' ? catBlock.description : '',
    questions: [
      {
        id: 'tires_model',
        prompt: 'Tire',
        subcategory: 'Tire catalog',
        answerType: 'select',
        selectSortControl: 'alpha_points',
        options: flatOptions
      },
      ...tail
    ]
  };
}
