import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import examples from './examples/manifest.json' with { type: 'json' };

const EXAMPLE_SLOT = /<!-- relgraph:examples\b[^>]*-->/g;
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
/** The example buttons of the data-source card, one per manifest entry. */
function exampleButtons() {
  return examples
    .map(
      (e) =>
        `<button id="${escapeHtml(e.id)}"${e.wide ? ' class="source-wide"' : ''} type="button" aria-pressed="false">` +
        `<b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.subtitle)}</small></button>`,
    )
    .join('\n        ');
}

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
      // examples/manifest.json is the one list of shipped examples: it fills the
      // data-source card here, and the studio and the build read the same file.
      name: 'example-buttons',
      transformIndexHtml(html) {
        const slots = html.match(EXAMPLE_SLOT)?.length ?? 0;
        if (slots !== 1) throw new Error(`Expected one example slot in the page, found ${slots}`);
        return html.replace(EXAMPLE_SLOT, exampleButtons());
      },
    },
    {
      // Keep the shipped examples as files: users can inspect and load them as JSON.
      name: 'include-example-documents',
      apply: 'build',
      async generateBundle() {
        for (const { file } of examples) {
          this.emitFile({
            type: 'asset',
            fileName: `examples/${file}`,
            source: await readFile(new URL(`./examples/${file}`, import.meta.url)),
          });
        }
      },
    },
  ],
});
