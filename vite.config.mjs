import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

// Keep the shipped examples as files: users can inspect and load them as JSON.
const exampleFiles = ['honglou-provisional.relgraph.json', 'biology-signaling-synthetic.json'];

export default defineConfig({
  base: './',
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
