# Workbook Data Source

## Source file

- Default workbook path used by converter:
  - `/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx`

## Conversion command

- Run `npm run data:convert`
- Optional explicit workbook path:
  - `npm run data:convert -- "/absolute/path/to/workbook.xlsx"`

## Source JSON extraction command

- Run `npm run data:extract-source`
- This creates category files under `rules-source/` for long-term JSON-based maintenance.

## Output

- Converter writes normalized JSON to:
  - `src/lib/data/rules.v1.json`
- Extractor writes source JSON files to:
  - `rules-source/index.json`
  - `rules-source/vehicles.json`
  - `rules-source/engine.json`
  - `rules-source/drivetrain.json`
  - `rules-source/suspension.json`
  - `rules-source/brakes.json`
  - `rules-source/exterior.json`
  - `rules-source/weight.json`
  - `rules-source/tires.json`

## Notes

- MVP conversion focuses on major category sheets only.
- Rule math/scoring expressions are intentionally deferred to later phases.
