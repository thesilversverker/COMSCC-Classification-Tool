import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

// Logical component: GitHub Pages base-path handling.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isPagesCi = process.env.GITHUB_ACTIONS === 'true';
const basePath = isPagesCi && repoName ? `/${repoName}/` : '/';

import fs from 'node:fs';
import path from 'node:path';

const BUILD_YEAR_MARKER = '%BUILD_YEAR%';

/**
 * SvelteKit writes SPA fallback HTML after Vite's index transforms; patch `build/*.html` once the adapter finishes.
 * Plugin is registered before `sveltekit()` so `closeBundle` runs after the kit adapter (reverse hook order).
 */
function injectBuildYearPlugin() {
  return {
    name: 'inject-build-year',
    closeBundle() {
      const year = String(new Date().getFullYear());
      const outDir = path.resolve('build');
      if (!fs.existsSync(outDir)) return;
      for (const name of fs.readdirSync(outDir)) {
        if (!name.endsWith('.html')) continue;
        const file = path.join(outDir, name);
        const html = fs.readFileSync(file, 'utf8');
        if (!html.includes(BUILD_YEAR_MARKER)) continue;
        fs.writeFileSync(file, html.split(BUILD_YEAR_MARKER).join(year), 'utf8');
      }
    }
  };
}

export default defineConfig({
  plugins: [injectBuildYearPlugin(), sveltekit()],
  base: basePath
});
