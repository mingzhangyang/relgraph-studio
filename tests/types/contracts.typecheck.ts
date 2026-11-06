import type { GraphDoc, PresentationStep } from '../../types/relationship-graph';
import { layoutGraph } from '../../src/director/layout';

const document: GraphDoc = {
  schemaVersion: '0.1',
  meta: { title: 'Example' },
  characters: [{ id: 'a', name: 'A', importance: 1, bio: { summary: 'A' } }],
  relations: [],
};
const scene: PresentationStep = { id: 'one', title: document.meta.title, durationSec: 1 };
void scene;

// @ts-expect-error The source version is fixed by the JSON Schema.
document.schemaVersion = '1.0';
layoutGraph({
  // @ts-expect-error A required layout coordinate must be numeric.
  nodes: [{ id: 'a', label: 'A', kind: 'person', position: { x: '0', y: 0 } }],
  edges: [],
});
