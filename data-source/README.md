
### Build the app bundle (`rules.v1.json`)

- Run `npm run data:build`
- Merges:
  - Checkbox-style categories from `rules-source/` (Engine, Drivetrain, Suspension, Brakes, Exterior) with numeric `pointValue` from the **Assessment** column
  - Preset categories from [`src/lib/data/presets/vehicles-tires-weight.json`](../src/lib/data/presets/vehicles-tires-weight.json) (Vehicles, Weight, Tires)

### One-shot refresh (when the workbook changes locally)

- Run `npm run data:sync` (extract + build)

## Output paths

- **Runtime bundle (imported by the app):** `src/lib/data/rules.v1.json`
- **Per-sheet source files:** `rules-source/*.json` and `rules-source/index.json`

## Notes

- Modification worksheets use **column B = Assessment**, **column C = Description**; each row becomes a checkbox question with `pointValue` when the assessment is numeric, or `needsManualPoints` when it is non-numeric (for example **Dyno**).
- Vehicles, Weight, and Tires use different table layouts; their UI is maintained in the preset JSON file above.
- **Vehicle trims / styles:** `npm run data:compose-vehicles` runs `scripts/generate-open-vehicle-styles-from-comscc-catalog.mjs`, which builds `rules-source/open-vehicle/styles/{make_slug}.json` from **named** `vehicleTrim` rows in `rules-source/vehicles-comscc-catalog.json` (year ranges merged per trim). The app picker uses Make → Model → Year first; a trim control appears only when that catalog lists named trims for the selected year (or Base + named when a null-trim row also applies).
- GitHub Actions runs `npm run data:build` only; commit updated `rules-source/` and/or the preset when rule data changes.
