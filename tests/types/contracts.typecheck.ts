import type { GraphDoc, PresentationStep } from '../../types/relationship-graph';
import type { VisualGraph } from '../../types/visual-graph';
import { layoutGraph } from '../../src/director/layout';
import { directorFrameAt } from '../../src/director/state';
import { frameStateAt, validateVisualGraph } from '../../src/graph/core';

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

declare const graph: VisualGraph;
declare const untrusted: unknown;
const diagnostics = validateVisualGraph(untrusted);
const frame = frameStateAt(graph, 0);
const safeSceneId: string | undefined = frame.playback.scene?.id;
const selectedGroup: string | null = frame.highlight.groupId;
const cameraScale: number = directorFrameAt(graph, layoutGraph(graph), 0).cameraResolved.scale;
void [diagnostics, safeSceneId, selectedGroup, cameraScale];
// @ts-expect-error Frame indices are numeric, not strings.
frameStateAt(graph, '0');
// @ts-expect-error A redacted scene has no guaranteed identifier.
const unsafeSceneId: string = frame.playback.scene?.id;
void unsafeSceneId;
