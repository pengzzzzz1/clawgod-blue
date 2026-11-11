import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Vite still builds web/dist for local preview. GitHub Pages uses the
// catalog-generated file at repo root (`node web/render-landing.mjs`).
//
// closeBundle is the cleanest hook for this: runs once after the bundle is
// fully written, only during `vite build` (not dev). `apply: 'build'`
// keeps the plugin out of the dev pipeline entirely.
export default defineConfig({
  plugins: [
    viteSingleFile(),
    {
      name: 'deploy-to-repo-root',
      apply: 'build',
      closeBundle() {
        // GitHub Pages serves repo-root index.html generated from
        // src/shared/patch.mjs via `node web/render-landing.mjs`.
        // Do not copy the Vite marketing template over that file.
        // eslint-disable-next-line no-console
        console.log('[deploy] skipped; landing is web/render-landing.mjs');
      },
    },
  ],
  build: {
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
