// Logical component: derive Trim/Style choices from COMSCC seed catalog for Make → Model → Year → optional Trim.

function normToken(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Session value meaning “base / null-trim catalog row” when trim UI is shown. */
export const COMSCC_TRIM_BASE_SENTINEL = '__comscc_base__';

export type ComsccCatalogSeedRow = {
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleTrim?: string | null;
  vehicleYearBegin?: number;
  vehicleYearEnd?: number;
};

export type ComsccTrimChoice = {
  /** Select `value`; use {@link COMSCC_TRIM_BASE_SENTINEL} for Base. */
  id: string;
  label: string;
  /** Row `trimKey` in showroom lookup (null = base). */
  trimKey: string | null;
};

function trimCell(row: ComsccCatalogSeedRow): string | null {
  const v = row.vehicleTrim;
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function yearOverlapsRow(row: ComsccCatalogSeedRow, year: number): boolean {
  const sy = typeof row.vehicleYearBegin === 'number' ? row.vehicleYearBegin : null;
  const ey = typeof row.vehicleYearEnd === 'number' ? row.vehicleYearEnd : null;
  if (sy !== null && year < sy) return false;
  if (ey !== null && year > ey) return false;
  return true;
}

/**
 * Rows in `vehicles-comscc-catalog.json` `vehicleCatalog` that apply to this make, model, and year.
 */
export function comsccCatalogRowsForYear(
  vehicleCatalog: readonly ComsccCatalogSeedRow[] | null | undefined,
  makeLabel: string,
  modelLabel: string,
  year: number
): ComsccCatalogSeedRow[] {
  if (!Array.isArray(vehicleCatalog) || !Number.isInteger(year)) return [];
  const mMake = normToken(makeLabel);
  const mModel = normToken(modelLabel);
  return vehicleCatalog.filter((row) => {
    const mk = typeof row.vehicleMake === 'string' ? normToken(row.vehicleMake) : '';
    const mo = typeof row.vehicleModel === 'string' ? normToken(row.vehicleModel) : '';
    if (mk !== mMake || mo !== mModel) return false;
    return yearOverlapsRow(row, year);
  });
}

/**
 * Trim/style `<select>` options when the COMSCC catalog defines named trims for this year, or Base + named when both apply.
 * Returns [] when a single implicit base row covers the year (no extra UI).
 */
export function comsccTrimChoicesForYear(
  vehicleCatalog: readonly ComsccCatalogSeedRow[] | null | undefined,
  makeLabel: string,
  modelLabel: string,
  year: number
): ComsccTrimChoice[] {
  const hits = comsccCatalogRowsForYear(vehicleCatalog, makeLabel, modelLabel, year);
  if (hits.length === 0) return [];

  const hasNull = hits.some((row) => trimCell(row) === null);
  const namedOrdered: string[] = [];
  const seen = new Set<string>();
  for (const row of hits) {
    const t = trimCell(row);
    if (t === null) continue;
    const key = normToken(t);
    if (seen.has(key)) continue;
    seen.add(key);
    namedOrdered.push(t);
  }

  if (namedOrdered.length === 0) {
    return [];
  }

  const out: ComsccTrimChoice[] = [];
  if (hasNull) {
    out.push({ id: COMSCC_TRIM_BASE_SENTINEL, label: 'Base', trimKey: null });
  }
  for (const t of namedOrdered) {
    out.push({ id: t, label: t, trimKey: t });
  }
  return out;
}
