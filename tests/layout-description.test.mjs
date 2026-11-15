// What the workspace says about layouts before and after they run (PR 6):
// pure checks of the core rules the layout panel reads.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import examples from '../examples/manifest.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import {
  DEFAULT_LAYOUT_SETTINGS,
  planLayout,
  strategyEngine,
} from '../packages/core/src/director/layout-strategies.ts';
import { LAYOUT_TYPES } from '../packages/core/src/project-layout.ts';

const example = (file) =>
  JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
const graphs = examples.map(({ id, file }) => [id, loadDocument(example(file)).graph]);
const strategies = LAYOUT_TYPES.filter((type) => type !== 'manual');

test('strategyEngine names the engine and reason planLayout reports, without running it', () => {
  for (const [id, graph] of graphs) {
    const current = layoutGraph(graph);
    for (const type of strategies) {
      const plan = planLayout(
        graph,
        { ...DEFAULT_LAYOUT_SETTINGS, type, mode: 'rearrange' },
        current,
      );
      if (plan.blocked.length) continue;
      assert.deepEqual(
        strategyEngine(graph, type),
        { engine: plan.engine, reason: plan.reason },
        `${id} / ${type}`,
      );
    }
  }
});
