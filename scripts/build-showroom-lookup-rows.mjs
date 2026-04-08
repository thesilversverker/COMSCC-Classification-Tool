// Logical component: flatten plowman/open-vehicle-db makes_and_models.json and overlay COMSCC seed rows (template nulls when no match).

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normToken(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function yearSpanWidth(c) {
  const sy = c.startYear ?? 1900;
  const ey = c.endYear ?? 2100;
  return Math.max(0, ey - sy);
}

/** Best COMSCC row for open-db make/model/year (narrowest year range wins). */
export function pickComsccRow(makeName, modelName, year, comsccRows) {
  const mMake = normToken(makeName);
  const mModel = normToken(modelName);
  const candidates = comsccRows.filter((c) => {
    if (normToken(c.make) !== mMake || normToken(c.model) !== mModel) return false;
    if (c.startYear !== null && year < c.startYear) return false;
    if (c.endYear !== null && year > c.endYear) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (yearSpanWidth(c) < yearSpanWidth(best) ? c : best));
}

export function flattenOpenDb(openDb) {
  /** @type {Array<{ makeSlug: string, makeName: string, modelKey: string, modelName: string, year: number, trimKey: string | null, trimLabel: string | null }>} */
  const out = [];
  for (const make of openDb) {
    const makeSlug = make.make_slug;
    const makeName = make.make_name;
    const models = make.models ?? {};
    for (const [modelKey, model] of Object.entries(models)) {
      const modelName = model.model_name ?? modelKey;
      const styles = model.model_styles ?? {};
      const styleKeys = Object.keys(styles);
      if (styleKeys.length === 0) {
        for (const year of model.years ?? []) {
          if (typeof year !== 'number') continue;
          out.push({
            makeSlug,
            makeName,
            modelKey,
            modelName,
            year,
            trimKey: null,
            trimLabel: null
          });
        }
      } else {
        for (const sk of styleKeys) {
          const st = styles[sk];
          const ys =
            Array.isArray(st?.years) && st.years.length > 0 ? st.years : model.years ?? [];
          for (const year of ys) {
            if (typeof year !== 'number') continue;
            out.push({
              makeSlug,
              makeName,
              modelKey,
              modelName,
              year,
              trimKey: sk,
              trimLabel: sk
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * @param {unknown} openDb - top-level array from open-vehicle-db data/makes_and_models.json
 * @param {{ vehicleCatalog: unknown[], sourceWorkbook?: string }} comsccDoc - vehicles-comscc-catalog.json
 * @returns {{ rows: object[], mergedCount: number, flatCount: number, comsccSeedCount: number }}
 */
export function buildShowroomLookupRows(openDb, comsccDoc) {
  const comsccRows = comsccDoc?.vehicleCatalog;
  if (!Array.isArray(comsccRows)) {
    throw new Error('vehicles-comscc-catalog.json must contain vehicleCatalog array');
  }
  if (!Array.isArray(openDb)) {
    throw new Error('open-vehicle-db JSON must be a top-level array (makes_and_models.json)');
  }

  const flat = flattenOpenDb(openDb);
  let mergedCount = 0;
  const rows = [];

  for (const row of flat) {
    const comscc = pickComsccRow(row.makeName, row.modelName, row.year, comsccRows);
    if (comscc) mergedCount += 1;

    const trimPart = row.trimKey ? `_${slugify(row.trimKey)}` : '';
    const id = `ov_${slugify(row.makeSlug)}_${slugify(row.modelKey)}_${row.year}${trimPart}`;

    rows.push({
      makeNorm: normToken(row.makeName),
      modelNorm: normToken(row.modelName),
      year: row.year,
      trimKey: row.trimKey,
      showroomAssessment:
        typeof comscc?.showroomAssessment === 'number' && Number.isFinite(comscc.showroomAssessment)
          ? comscc.showroomAssessment
          : null,
      showroomBaseWeightLbs:
        typeof comscc?.showroomBaseWeightLbs === 'number' && Number.isFinite(comscc.showroomBaseWeightLbs)
          ? comscc.showroomBaseWeightLbs
          : null,
      baseClassification:
        typeof comscc?.baseClassification === 'string' && comscc.baseClassification.trim()
          ? comscc.baseClassification.trim()
          : null,
      catalogId: id,
      comsccEnriched: Boolean(comscc)
    });
  }

  return {
    rows,
    mergedCount,
    flatCount: flat.length,
    comsccSeedCount: comsccRows.length
  };
}
