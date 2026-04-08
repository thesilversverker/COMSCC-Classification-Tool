# Workbook Data Source

## Source file

- Default workbook path used by converter:
  - `/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx`

## Conversion command

- Run `npm run data:convert`
- Optional explicit workbook path:
  - `npm run data:convert -- "/absolute/path/to/workbook.xlsx"`

## Output

- Converter writes normalized JSON to:
  - `src/lib/data/rules.v1.json`

## Notes

- MVP conversion focuses on major category sheets only.
- Rule math/scoring expressions are intentionally deferred to later phases.
