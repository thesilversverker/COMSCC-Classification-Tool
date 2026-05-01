# COMSCC Classification Tool

Static Svelte app scaffold for COMSCC touring classification workflow.

## Tech stack

- SvelteKit + TypeScript
- Static output for GitHub Pages
- Browser-only state persistence (localStorage)

## Local development

- Install dependencies: `npm install`
- Build the runtime rules bundle: `npm run data:build`
- Start dev server: `npm run dev`
- Run type checks: `npm run check`
- Run tests: `npm run test`

## Data pipeline

- Source of truth: hand-curated JSON under `rules-source/`.
- Build command: `npm run data:build` composes `rules-source/vehicles.json`
  from the COMSCC catalog and open-vehicle data, then `build-rules-bundle.mjs`
  produces the runtime bundle at `src/lib/data/rules.v1.json`.
- Detail: see [`data-source/README.md`](data-source/README.md).

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

- `npm run data:build`
- `npm run check`
- `npm run test`
- `npm run build`
- `npm run preview` and load the app locally
