
### Build the app bundle (`rules.v1.json`)

- Run `npm run data:build`
- Merges:
  - Checkbox-style categories from `rules-source/` (Engine, Drivetrain, Suspension, Brakes, Exterior) with numeric `pointValue` from the **Assessment** column
  - Preset categories from [`src/lib/data/presets/vehicles-tires-weight.json`](../src/lib/data/presets/vehicles-tires-weight.json) (Vehicles, Weight, Tires)

### Rebuild after editing rules-source

- Run `npm run data:build`

## Output paths

- **Runtime bundle (imported by the app):** `src/lib/data/rules.v1.json`
- **Per-sheet source files:** `rules-source/*.json` and `rules-source/index.json`

## Notes

- Modification worksheets use **column B = Assessment**, **column C = Description**; each row becomes a checkbox question with `pointValue` when the assessment is numeric, or `needsManualPoints` when it is non-numeric (for example **Dyno**).
- Vehicles, Weight, and Tires use different table layouts; their UI is maintained in the preset JSON file above.
- **Vehicle trims / styles:** `rules-source/open-vehicle/styles/{make_slug}.json` is curator-managed; `npm run data:compose-vehicles` overlays those style maps onto `rules-source/open-vehicle/makes_and_models.json` and joins them with COMSCC `vehicleTrim` rows from `rules-source/vehicles-comscc-catalog.json`. The app picker uses Make → Model → Year first; a trim control appears only when that catalog lists named trims for the selected year (or Base + named when a null-trim row also applies).
- All `rules-source/**/*.json` files are committed and edited directly. The CSV files in this directory (`COMSCC-unprotected.csv`, `vehicle-catalog-from-csv.json`, `vehicle-catalog-rejects.csv`) are archival inputs from the initial bootstrap; nothing in the build pipeline reads them.
- GitHub Actions runs `npm run data:build` only; commit updated `rules-source/` and/or the preset when rule data changes.

## NHTSA refresh pipeline (operator-only, Python)

This directory hosts the operator-side Python tooling for refreshing NHTSA VPIC
data into the committed source under `rules-source/open-vehicle/`. CI never
runs any of this — it is invoked manually when curators need new baseline data.

### One-time setup

```bash
python3 -m venv data-source/.venv
data-source/.venv/bin/pip install -r data-source/requirements.txt
```

The venv directory is gitignored. Re-run the second command after pulling new
commits that touch `data-source/requirements.txt`.

### Subcommand layout

Flags always belong on the subcommand (`plan --json`, not `--json plan`).
`styles-only` and `models-only` are reserved for later refinement; `plan`,
`bootstrap`, and `update` are the live operator surface.

#### `plan` — offline dry-run

Walks the cache + catalog and prints what an `update` run *would* fetch,
classified per the TTL policy. No network, no writes.

```bash
data-source/.venv/bin/python data-source/refresh_nhtsa_vehicle_source.py plan
data-source/.venv/bin/python data-source/refresh_nhtsa_vehicle_source.py plan --json
data-source/.venv/bin/python data-source/refresh_nhtsa_vehicle_source.py plan --ignore-ttl
```

#### `bootstrap` — full refresh, writes Layer 2

Fetches the makes endpoint plus models for every catalog make across the full
year window, plus Canadian specs for every catalog `(year, make, model)`.
Writes the four Layer 2 files into `rules-source/open-vehicle/nhtsa-source/`
**only** if the run's fail rate stays under `--max-fail-rate` (default 2%).

```bash
data-source/.venv/bin/python data-source/refresh_nhtsa_vehicle_source.py bootstrap \
  --year-from 1985 --year-to 2026 \
  --max-rps 5 --max-workers 6 \
  --lock-mode fail
```

The cache directory lock is held for the entire run; a second concurrent
operator either waits (`--lock-mode wait`) or aborts (`--lock-mode fail`).

Output files (committed):

- `nhtsa-source/nhtsa-makes-models-source.json` — VPIC baseline.
- `nhtsa-source/nhtsa-catalog-style-details-source.json` — Canadian specs
  rows, one per catalog tuple.
- `nhtsa-source/source-manifest.json` — refresh provenance (mode, year span,
  catalog hash, response-set rollup hash, fail rate).
- `nhtsa-source/validation-report.json` — issues found during refresh
  (`emptyDetailTuples`, malformed bodies as `staleAliases` until step 6
  fills in the alias resolution side).

#### `update` — delta refresh

Same shape as `bootstrap` but only re-fetches models for
`[currentYear - --recent-years + 1 .. currentYear]`. Historical model lists
remain immutable per the TTL policy; the cache file lock keeps the run
exclusive.

```bash
data-source/.venv/bin/python data-source/refresh_nhtsa_vehicle_source.py update \
  --recent-years 3
```

### Baseline counts (regression floor)

`rules-source/open-vehicle/baseline-counts.json` holds the per-make floor that
the projection step (step 6+) compares against. It is committed and
human-curated; do not let projection silently rewrite it. Reseed it with:

```bash
data-source/.venv/bin/python data-source/seed_baseline_counts.py
```

Re-run only when an intentional shrink has been reviewed and the new floor
is what the curator wants future runs to enforce.

### Cache layout

Operator-only, gitignored, regeneratable:

```
data-source/.cache/vpic/
  .lock                            POSIX advisory lock (fail or wait)
  manifest.json                    canonical "what's cached" index
  GetMakesForVehicleType/*.json    one file per response, sha256 in manifest
  GetModelsForMakeYear/*.json
  GetCanadianVehicleSpecifications/*.json
```

### Per-class TTL policy

Implemented in `vpic_cache.TTLPolicy`. Aligned with the parent plan's policy
table: 7-day TTL on the makes endpoint, 30-day TTL on historical Canadian
specs, "every run" for current and prior model year, and infinite for
historical model lists (only invalidated by `--full-refresh` in step 5+).

### `SKIP_OPEN_VEHICLE_SYNC` escape hatch

If `SKIP_OPEN_VEHICLE_SYNC=1` is set in the environment, the refresh script
exits 0 immediately *before* parsing arguments. Defense in depth so CI
containers, hermetic builders, and pre-commit hooks can guarantee no NHTSA
network call regardless of how the script is invoked.

```bash
SKIP_OPEN_VEHICLE_SYNC=1 data-source/.venv/bin/python data-source/refresh_nhtsa_vehicle_source.py plan
# stderr: "SKIP_OPEN_VEHICLE_SYNC set; skipping NHTSA refresh."
# exit 0
```

Falsy values (`""`, `0`, `false`) are ignored.

### Running the test suite

```bash
cd data-source && .venv/bin/pytest
```

All Python tests use stub transports keyed by request URL — no network is ever
opened by the test suite. Fixtures live under `data-source/tests/fixtures/vpic/`.
