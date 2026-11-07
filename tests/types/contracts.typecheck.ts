import { createCanvasRenderer, themeFor } from '../../packages/render/src/canvas';
import type { DirectorFrameState } from '../../packages/core/types/visual-graph';
import { inspectRelGraph, validateRelGraph, visibleStory } from '../../packages/core/src/relgraph';
import { validateBiologyDocument } from '../../packages/core/src/domains/biology';
import { loadDocument, parseDocument } from '../../packages/core/src/director/load';
import type { GraphDoc, PresentationStep } from '../../packages/core/types/relationship-graph';
import type { VisualGraph } from '../../packages/core/types/visual-graph';
import { layoutGraph } from '../../packages/core/src/director/layout';
import { directorFrameAt } from '../../packages/core/src/director/state';
import { frameStateAt, validateVisualGraph } from '../../packages/core/src/graph/core';

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
if (frame.playback.scene !== null) {
  // @ts-expect-error A redacted scene has no guaranteed identifier.
  const unsafeSceneId: string = frame.playback.scene.id;
  void unsafeSceneId;
}

const literaryCheck = validateRelGraph(untrusted);
const biologicalCheck = validateBiologyDocument(untrusted);
const loaded = loadDocument(untrusted);
if (loaded.valid) {
  const title: string = loaded.graph.meta.title;
  const summary: string | undefined = loaded.detailAt('a', 1)?.summary;
  void [title, summary];
} else {
  // @ts-expect-error A failed load does not expose a graph.
  const missingGraph = loaded.graph;
  void missingGraph;
}
const inspected = inspectRelGraph(untrusted);
if (inspected.valid) visibleStory(inspected.document, 1);
// @ts-expect-error Untrusted input must be validated before direct projection.
visibleStory(untrusted, 1);
// @ts-expect-error JSON input is text, not an arbitrary value.
parseDocument(untrusted);
void [literaryCheck, biologicalCheck];

// Renderer contracts connect the typed graph, layout and browser canvas.
declare const canvas: HTMLCanvasElement;
const renderer = createCanvasRenderer(canvas, graph, layoutGraph(graph), {
  fps: 24,
  theme: 'light',
  detailAt: (id, at) => ({ summary: `${id} ${at}` }),
});
const rendered: DirectorFrameState = renderer.renderFrame(0);
const resolvedTheme: 'dark' | 'light' = themeFor(untrusted).name;
void [rendered, resolvedTheme];
// @ts-expect-error Frames are numeric.
renderer.renderFrame('0');
// @ts-expect-error FPS must be numeric.
createCanvasRenderer(canvas, graph, layoutGraph(graph), { fps: '24' });

// The browser frame API has a typed input and returns an independent safe state.
const didRender: boolean = window.renderAt(0);
const inspectedFrame: DirectorFrameState | null = window.studioFrame();
void [didRender, inspectedFrame];
// @ts-expect-error Frame indices are numbers.
window.renderAt('1');
