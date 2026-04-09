// Logical component: flatten plowman/open-vehicle-db makes_and_models.json and overlay COMSCC seed rows (template nulls when no match).

export function slugify(value) {
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
 * @param {unknown[]} vehicleCatalog - rules-source/vehicles.json category.vehicleCatalog (composed rows)
 * @param {{ overrideRowCount?: number }} meta
 * @returns {{ rows: object[], mergedCount: number, flatCount: number, comsccSeedCount: number }}
 */
export function buildShowroomLookupRowsFromVehicleCatalog(vehicleCatalog, meta = {}) {
  if (!Array.isArray(vehicleCatalog)) {
    throw new Error('vehicleCatalog must be an array (run npm run data:compose-vehicles)');
  }

  const rows = vehicleCatalog.map((r) => {
    const trimKey = typeof r.trimKey === 'string' && r.trimKey.length > 0 ? r.trimKey : null;
    return {
      makeNorm: normToken(r.makeName),
      modelNorm: normToken(r.modelName),
      year: typeof r.year === 'number' ? r.year : null,
      trimKey,
      showroomAssessment:
        typeof r.showroomAssessment === 'number' && Number.isFinite(r.showroomAssessment)
          ? r.showroomAssessment
          : null,
      showroomBaseWeightLbs:
        typeof r.showroomBaseWeightLbs === 'number' && Number.isFinite(r.showroomBaseWeightLbs)
          ? r.showroomBaseWeightLbs
          : null,
      baseClassification:
        typeof r.baseClassification === 'string' && r.baseClassification.trim()
          ? r.baseClassification.trim()
          : null,
      catalogId: typeof r.id === 'string' ? r.id : '',
      comsccEnriched: Boolean(r.comsccMatched)
    };
  });

  const mergedCount = vehicleCatalog.filter((r) => r.comsccMatched).length;

  return {
    rows,
    mergedCount,
    flatCount: vehicleCatalog.length,
    comsccSeedCount: typeof meta.overrideRowCount === 'number' ? meta.overrideRowCount : 0
  };
}
