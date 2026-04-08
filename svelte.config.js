import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/kit/vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isPagesCi = process.env.GITHUB_ACTIONS === 'true';
const basePath = isPagesCi && repoName ? `/${repoName}` : '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  // Logical component: SvelteKit static adapter for GitHub Pages.
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: '404.html'
    }),
    paths: {
      base: basePath
    },
    alias: {
      $components: 'src/lib/components',
      $stores: 'src/lib/stores',
      $types: 'src/lib/types',
      $data: 'src/lib/data'
    }
  }
};

export default config;
