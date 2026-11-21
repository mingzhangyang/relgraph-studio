// The evidence card's invariant (ADR 004, D4), checked over a parameter
// sweep rather than single examples: on every frame that draws a card, the
// card covers nothing drawn for its object - neither end's glyph, the
// relation's stroke, either end's name label nor the relation's own label -
// the object's glyphs are drawn wholly on the stage (D7 step 1: framing
// into the free area must not push them off it), and a card shot that can
// show its card does show it.
//
// The sweep varies what earlier reviews found one at a time: node shape
// (compact, label-holding, timeline bars), geometry, the card shot's camera
// (none, fitIds, focus, zoom), a transition from a distant node, card height,
// label length, the card's object and the frame spec (every preset, so the
// card region below the graph in portrait and 3:4 is swept like the one
// beside it); and cited self-loops,
// whose route the camera does not know, so their card may be withheld - but
// only with a report, never silently.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import { styleForGraph } from '../packages/core/src/style.ts';
import { composeFrame, drawingStyle } from '../packages/render/src/compose.ts';
import { evidenceCameraFit } from '../packages/render/src/camera-fit.ts';
import { evidenceCardRegion, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { measure } from './helpers/display-list.mjs';

const SHAPES = ['circle', 'hexagon', 'diamond', 'box', 'capsule', 'decision'];
const GEOMETRY = {
  horizontal: [
    { x: -300, y: 0 },
    { x: 300, y: 0 },
  ],
  vertical: [
    { x: 0, y: -260 },
    { x: 0, y: 260 },
  ],
  diagonal: [
    { x: -300, y: -200 },
    { x: 300, y: 200 },
  ],
};
const CAMERAS = {
  none: undefined,
  fit: { fitIds: ['b'] },
  focus: { focusNodeId: 'b' },
  zoomOut: { zoom: 0.5 },
  zoom2: { zoom: 2 },
  zoom3: { zoom: 3 },
  focusZoom: { focusNodeId: 'a', zoom: 2 },
};
const SHORT = { a: '沈墨', b: '顾青' };
const LONG = { a: '甲乙丙丁戊己庚辛壬癸子丑', b: 'MMMMMMMMMMMMMM' };
const TALL = [
  { cite: '某书', quote: '二人同行，自西岭至东湖，往返三日，途中唱和诗十余首。'.repeat(4) },
];
const TAG = '书信往来';

function documentFor({ shape, geometry, camera, labels, tall, object }) {
  const [pa, pb] = GEOMETRY[geometry];
  return {
    format: 'relgraph.graph/1',
    kinds: { nodes: { k: { shape } } },
    nodes: [
      { id: 'a', label: labels.a, kind: 'k', position: pa, ...(object === 'node' ? {} : {}) },
      {
        id: 'b',
        label: labels.b,
        kind: 'k',
        position: pb,
        ...(object === 'node' ? { evidence: tall ? TALL : ['某书'] } : {}),
      },
      { id: 'o', label: '远处', kind: 'k', position: { x: -1600, y: 500 } },
    ],
    edges: [
      {
        id: 'r',
        source: 'a',
        target: 'b',
        label: TAG,
        ...(object === 'edge' ? { evidence: tall ? TALL : ['某书'] } : {}),
      },
    ],
    presentation: [
      { id: 'away', title: '远处', durationSec: 2, camera: { focusNodeId: 'o' } },
      {
        id: 'card',
        title: '卡片',
        durationSec: 4,
        transitionMs: 1200,
        ...(camera ? { camera } : {}),
        evidence: object === 'node' ? { nodeId: 'b' } : { edgeId: 'r' },
      },
    ],
  };
}

/** Timeline bars: two dated spans and one long span alone. */
function timelineDocuments() {
  const quote = [{ cite: 'A', quote: '甲'.repeat(100) }];
  return [
    {
      name: 'timeline/two-spans',
      doc: {
        format: 'relgraph.graph/1',
        diagram: 'timeline',
        nodes: [
          { id: 'a', label: '前朝', start: 0, end: 40 },
          { id: 'b', label: '后朝', start: 50, end: 100 },
        ],
        edges: [{ id: 'r', source: 'a', target: 'b', label: TAG, evidence: quote }],
        presentation: [
          { id: 'all', title: '全', durationSec: 2, domainAt: 100 },
          { id: 'card', title: '卡', durationSec: 4, domainAt: 100, evidence: { edgeId: 'r' } },
        ],
      },
    },
    ...[undefined, { zoom: 2 }].map((camera, i) => ({
      name: `timeline/one-span${camera ? '-zoom2' : ''}`,
      doc: {
        format: 'relgraph.graph/1',
        diagram: 'timeline',
        nodes: [{ id: 'era', start: 0, end: 100, evidence: quote }],
        presentation: [
          {
            title: 'Era',
            domainAt: 100,
            durationSec: 4 + i,
            ...(camera ? { camera } : {}),
            evidence: { nodeId: 'era' },
          },
        ],
      },
    })),
  ];
}

const intersects = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The box a text item covers, measured as the composer measured it. */
function textBox(item) {
  const w = measure(item.text, item.font),
    size = item.font.size;
  const x = item.align === 'center' ? item.x - w / 2 : item.align === 'right' ? item.x - w : item.x;
  const top =
    item.baseline === 'top'
      ? item.y
      : item.baseline === 'middle'
        ? item.y - size / 2
        : item.y - size * 0.85;
  return { x, y: top, w, h: size * 1.1 };
}

/** The relation's drawn stroke, densified, as small squares of its width. */
function strokeBoxes(points, width) {
  const boxes = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n,
        y = a.y + ((b.y - a.y) * k) / n;
      boxes.push({ x: x - width / 2, y: y - width / 2, w: width, h: width });
    }
  }
  return boxes;
}

/** Problems on one frame of a card shot; empty when the invariant holds. */
function frameProblems(list, frameSpec, endLabels, cited) {
  const region = evidenceCardRegion(frameSpec);
  const stage = list.items.find((item) => item.type === 'group' && item.clip);
  const plate = list.items
    .flatMap(function flat(item) {
      return item.type === 'group' ? item.items.flatMap(flat) : [item];
    })
    .find((item) => item.type === 'path' && item.d[0][0] === 'RR' && item.d[0][1] === region.x);
  if (!plate) return { drawn: false, problems: [] };
  const card = { x: plate.d[0][1], y: plate.d[0][2], w: plate.d[0][3], h: plate.d[0][4] };
  const problems = [];
  const inStage = (box) =>
    stage?.clip &&
    box.x >= stage.clip.x - 0.5 &&
    box.y >= stage.clip.y - 0.5 &&
    box.x + box.w <= stage.clip.x + stage.clip.w + 0.5 &&
    box.y + box.h <= stage.clip.y + stage.clip.h + 0.5;
  const shown = new Set();
  for (const entry of list.selection ?? []) {
    if (entry.kind === 'node' && cited.nodes.includes(entry.id) && entry.box) {
      shown.add(entry.id);
      if (intersects(entry.box, card)) problems.push(`glyph ${entry.id}`);
      // What the card is about is shown in full while the card is.
      if (!inStage(entry.box)) problems.push(`glyph ${entry.id} not wholly on stage`);
    }
    if (entry.kind === 'edge' && entry.id === cited.edge && entry.points)
      if (strokeBoxes(entry.points, entry.width ?? 1).some((box) => intersects(box, card)))
        problems.push('relation stroke');
  }
  for (const id of cited.nodes)
    if (!shown.has(id)) problems.push(`glyph ${id} not drawn with the card`);
  const texts = [];
  (function walk(items) {
    for (const item of items) {
      if (item.type === 'group') walk(item.items);
      else if (item.type === 'text') texts.push(item);
    }
  })(stage?.items ?? []);
  for (const text of texts) {
    const name = text.text.replace(/…$/, '');
    if (!name || !intersects(textBox(text), card)) continue;
    if (name === TAG) problems.push('relation label');
    else if (endLabels.some((label) => label.includes(name))) problems.push(`label ${text.text}`);
  }
  return { drawn: true, problems };
}

/**
 * `allowWithheld`: the camera knows nothing of a relation's route, so a
 * self-loop that reaches under the card may make it withhold the card. That
 * is allowed only when the frame reports it (`evidenceCovers`), never as a
 * card that silently does not show.
 */
function checkFilm(name, doc, frameSpec, { allowWithheld = false } = {}) {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
  const { graph } = result;
  const positions = layoutGraph(graph);
  const timeline = compileTimeline(graph, frameSpec.fps);
  const fit = evidenceCameraFit(frameSpec, graph, () =>
    drawingStyle({ graph, positions, style: styleForGraph(graph) }),
  );
  const starts = shotStartFrames(timeline);
  const total = frameCount(graph, frameSpec.fps);
  const index = timeline.shots.length - 1;
  const first = starts[index],
    last = total - 1;
  const endLabels = graph.nodes.map((node) => node.label);
  const card = timeline.shots[index].evidence;
  const edge = card.object === 'edge' ? graph.edges.find((e) => e.id === card.id) : null;
  const cited = {
    edge: edge?.id,
    nodes: edge ? [edge.source, edge.target] : [card.id],
  };
  const failures = new Set();
  let drawn = 0,
    lastList;
  for (let frame = first; frame <= last; frame += frame === last ? 1 : 3) {
    const f = Math.min(frame, last);
    const state = directorFrameAt(graph, positions, f, frameSpec.fps, { fit, timeline });
    const list = composeFrame(state, {
      graph,
      positions,
      frame: f,
      fps: frameSpec.fps,
      measure,
      frameSpec,
      theme: VIDEO_THEMES.dark,
      style: styleForGraph(graph),
      detailAt: result.detailAt,
    });
    lastList = list;
    const checked = frameProblems(list, frameSpec, endLabels, cited);
    if (checked.drawn) drawn++;
    for (const problem of checked.problems) failures.add(problem);
    if (f === last) break;
  }
  if (!drawn && !(allowWithheld && lastList.evidenceCovers))
    failures.add(
      lastList.evidenceCovers
        ? `card withheld (covers ${lastList.evidenceCovers.node})`
        : lastList.evidenceOverflow
          ? 'card overflow'
          : 'card never drawn',
    );
  return [...failures].map((problem) => `${name} @${frameSpec.name}: ${problem}`);
}

function sweepCases() {
  const cases = [];
  let n = 0;
  for (const shape of SHAPES)
    for (const geometry of Object.keys(GEOMETRY))
      for (const camera of Object.keys(CAMERAS)) {
        // Rotate the remaining dimensions so every value meets every shape.
        const labels = n % 2 ? LONG : SHORT;
        const tall = Math.floor(n / 2) % 2 === 1;
        const object = Math.floor(n / 4) % 2 ? 'node' : 'edge';
        n++;
        cases.push({
          name: `${shape}/${geometry}/${camera}/${labels === LONG ? 'long' : 'short'}/${tall ? 'tall' : 'short'}-card/${object}`,
          doc: documentFor({ shape, geometry, camera: CAMERAS[camera], labels, tall, object }),
        });
      }
  return [...cases, ...timelineDocuments()];
}

/** Self-loops on the right-hand node: 1, 4 or 8 loops, the card on the last. */
function loopCases() {
  const cases = [];
  for (const count of [1, 4, 8])
    for (const [camera, settings] of Object.entries({
      none: undefined,
      focusLeft: { focusNodeId: 'a' },
      focusLoop: { focusNodeId: 'b' },
      zoom2: { zoom: 2 },
    }))
      for (const tall of [false, true])
        cases.push({
          name: `loops${count}/${camera}/${tall ? 'tall' : 'short'}-card`,
          doc: {
            format: 'relgraph.graph/1',
            nodes: [
              { id: 'a', label: '沈墨', position: { x: -500, y: 0 } },
              { id: 'b', label: '顾青', position: { x: 500, y: 0 } },
            ],
            edges: Array.from({ length: count }, (_, i) => ({
              id: `loop${i}`,
              source: 'b',
              target: 'b',
              ...(i === count - 1 ? { label: TAG, evidence: tall ? TALL : ['某书'] } : {}),
            })),
            presentation: [
              {
                id: 'card',
                title: '卡片',
                durationSec: 4,
                ...(settings ? { camera: settings } : {}),
                evidence: { edgeId: `loop${count - 1}` },
              },
            ],
          },
        });
  return cases;
}

// Every preset: landscape beside the graph, portrait and 3:4 below it, square
// beside it in a narrower region (ADR 004, D7 step 1).
for (const specName of Object.keys(FRAME_SPECS))
  test(`evidence card invariant over the parameter sweep (${specName})`, () => {
    const frameSpec = FRAME_SPECS[specName];
    const failures = [
      ...sweepCases().flatMap(({ name, doc }) => checkFilm(name, doc, frameSpec)),
      ...loopCases().flatMap(({ name, doc }) =>
        checkFilm(name, doc, frameSpec, { allowWithheld: true }),
      ),
    ];
    assert.deepEqual(failures, [], `${failures.length} failures:\n${failures.join('\n')}`);
  }, 120_000);
