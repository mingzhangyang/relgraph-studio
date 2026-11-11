import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Keep the shipped examples as files: users can inspect and load them as JSON.
const exampleFiles = ['honglou-provisional.relgraph.json', 'biology-egfr-mapk.json'];

export default defineConfig({
  base: './',
  // The studio consumes workspace sources; installed packages use their built exports.
  resolve: {
    alias: [
      {
        find: /^@relgraph\/render\/skia$/,
        replacement: fileURLToPath(
          new URL('./packages/render/src/backends/skia.ts', import.meta.url),
        ),
      },
      {
        find: /^@relgraph\/core$/,
        replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      },
      {
        find: /^@relgraph\/render$/,
        replacement: fileURLToPath(new URL('./packages/render/src/index.ts', import.meta.url)),
      },
    ],
  },
  build: {
    rollupOptions: { input: 'demo/index.html' },
  },
  plugins: [
    {
      name: 'include-example-documents',
      apply: 'build',
      async generateBundle() {
        for (const filename of exampleFiles) {
          this.emitFile({
            type: 'asset',
            fileName: `examples/${filename}`,
            source: await readFile(new URL(`./examples/${filename}`, import.meta.url)),
          });
        }
      },
    },
  ],
});
