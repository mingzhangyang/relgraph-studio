import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

// VM tests exercise the actual TypeScript workspace against a minimal simulated DOM.
// The imported dependencies are supplied explicitly by each harness.
export function studioSource() {
  const source = readFileSync(new URL('../../apps/studio/src/studio.ts', import.meta.url), 'utf8');
  return transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  })
    .outputText.replace(/^import .*;\n/gm, '')
    .replace(/^export \{\};?\n/gm, '');
}
