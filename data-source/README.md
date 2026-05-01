
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
