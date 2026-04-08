# COMSCC Classification Tool

Static Svelte app scaffold for COMSCC touring classification workflow.

## Tech stack

- SvelteKit + TypeScript
- Static output for GitHub Pages
- Browser-only state persistence (localStorage)

## Local development

- Install dependencies: `npm install`
- Generate workbook-derived JSON: `npm run data:convert`
- Start dev server: `npm run dev`
- Run type checks: `npm run check`
- Run tests: `npm run test`

## Data pipeline

- Workbook conversion script: `scripts/convert-workbook.mjs`
- Output rules JSON: `src/lib/data/rules.v1.json`
- Default workbook path:
  - `/home/sysadmin/Downloads/COMSCC-2027-Touring-Classification-Tool_V2.01_TEST-SHEET.xlsx`

## GitHub Pages deployment modes

### 1) Same-repo Pages

- Workflow file: `.github/workflows/pages.yml`
- Push to `main` to trigger deploy.
- Vite base path auto-detects the repository name in GitHub Actions.

### 2) Dedicated deployment repo

- Keep this repo as source.
- Mirror static `build/` output to a dedicated pages repo using a follow-up workflow step or external sync action.
- Current workflow structure is compatible with adding that mirror step.

## Release smoke checklist

- `npm run data:convert`
- `npm run check`
- `npm run test`
- `npm run build`
- `npm run preview` and load the app locally
