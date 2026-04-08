# Workbook Data Source

## Source file

- Default workbook path used by scripts:
  - `/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx`

## Commands

### Legacy full-sheet converter (optional)

- Run `npm run data:convert`
- Optional explicit workbook path:
  - `npm run data:convert -- "/absolute/path/to/workbook.xlsx"`

### Extract `rules-source/` from the workbook

- Run `npm run data:extract-source`
- Optional explicit workbook path:
  - `npm run data:extract-source -- "/absolute/path/to/workbook.xlsx"`

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
- GitHub Actions runs `npm run data:build` only; commit updated `rules-source/` and/or the preset when rule data changes.
