import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

// Logical component: GitHub Pages base-path handling.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isPagesCi = process.env.GITHUB_ACTIONS === 'true';
const basePath = isPagesCi && repoName ? `/${repoName}/` : '/';

export default defineConfig({
  plugins: [sveltekit()],
  base: basePath
});
