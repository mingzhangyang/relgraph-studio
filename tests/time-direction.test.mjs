// The direction of time (ADR 004, D7 step 2): `config.view.timeAxis` in a
// Studio project, validated with the rest of `config` and kept by project
// export, drawn as a render-time transpose of the stored coordinates. The
// sweeps over composed frames are in frame-furniture-invariant and
// evidence-card-invariant; this file checks the field, the transpose as a
// whole film against the same film stored transposed, the time axis and
// bars of a timeline, the CLI's warning and chronology check, the engines'
// target aspect and the Tang 64 overview.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tang30 from '../datasets/tang-poets-met/唐代诗人见面网络_30.graph.json' with { type: 'json' };
import tang64 from '../datasets/tang-poets-met/唐代诗人见面网络_64.graph.json' with { type: 'json' };
import dynasties from '../examples/dynasties-timeline-provisional.graph.json' with { type: 'json' };
import bookshop from '../examples/bookshop-systems-synthetic.graph.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { frameCount } from '../packages/core/src/director/state.ts';
import { compileTimeline, shotStartFrames } from '../packages/core/src/director/timeline.ts';
import { chronologyInversions } from '../packages/core/src/director/chronology.ts';
import { runLayoutEngine } from '../packages/core/src/director/layout-engines.ts';
import {
  DEFAULT_LAYOUT_SETTINGS,
  planLayout,
} from '../packages/core/src/director/layout-strategies.ts';
import {
  drawnPositions,
  storedPoint,
  timeDirection,
} from '../packages/core/src/director/time-direction.ts';
import { createProject, validateProjectConfig } from '../packages/core/src/project.ts';
import { createHeadlessRenderer } from '../packages/render/src/backends/skia.ts';
import { engineAspect, FRAME_SPECS } from '../packages/render/src/frame-spec.ts';
import { glyphGeometry } from '../packages/render/src/node-geometry.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { timeAxisWarning } from '../packages/cli/src/render.ts';
import { checkLayout, formatLayoutIssues } from '../packages/cli/src/check-layout.ts';
import { readTimeAxis, timeDirectionProblems } from './helpers/time-direction.mjs';
import { readFrame } from './helpers/frame-furniture.mjs';
import { measure } from './helpers/display-list.mjs';

const project = (source, timeAxis) =>
  JSON.parse(JSON.stringify(createProject(source, timeAxis ? { view: { timeAxis } } : {})));
const loaded = (doc) => {
  const result = loadDocument(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
};
const sample = (graph, fps) => {
  const starts = shotStartFrames(compileTimeline(graph, fps));
  const total = frameCount(graph, fps);
  return starts.map((start, i) => Math.floor((start + (starts[i + 1] ?? total) - 1) / 2));
};

test('config.view.timeAxis is validated with the rest of config', () => {
  for (const timeAxis of ['horizontal', 'vertical'])
    assert.deepEqual(validateProjectConfig({ view: { timeAxis } }), [], timeAxis);
  assert.deepEqual(validateProjectConfig({ view: {} }), []);
  for (const [view, error] of [
    [{ timeAxis: 'diagonal' }, 'config.view.timeAxis'],
    [{ timeAxis: true }, 'config.view.timeAxis'],
    [{ timeAxis: 'vertical', flip: true }, 'config.view: unknown field'],
    ['vertical', 'config.view'],
    [null, 'config.view'],
  ])
    assert.ok(validateProjectConfig({ view }).includes(error), JSON.stringify(view));
  // Only a drawing on a time axis may turn upright: its nodes carry times.
  const untimed = loadDocument(project(bookshop, 'vertical'));
  assert.equal(untimed.valid, false);
  assert.match(JSON.stringify(untimed.errors), /config\.view\.timeAxis: the graph has no times/);
  assert.equal(loadDocument(project(bookshop, 'horizontal')).valid, true);
  for (const source of [dynasties, tang30])
    assert.equal(loadDocument(project(source, 'vertical')).valid, true);
});

test('the direction is read from the project only and round-trips through project export', () => {
  assert.equal(timeDirection(loaded(structuredClone(dynasties)).graph), 'horizontal');
  for (const timeAxis of ['horizontal', 'vertical']) {
    const first = loaded(project(dynasties, timeAxis)).graph;
    assert.equal(timeDirection(first), timeAxis);
    // What the studio's save writes: the project config as it is, around the source.
    const saved = JSON.parse(JSON.stringify(createProject(dynasties, first.project)));
    assert.deepEqual(saved.config.view, { timeAxis });
    const again = loaded(saved).graph;
    assert.deepEqual(again.project, first.project);
    assert.equal(timeDirection(again), timeAxis);
  }
});

test('drawn positions are the stored ones, transposed only when time runs down', () => {
  const stored = new Map([
    ['a', { x: 1, y: 2 }],
    ['b', { x: -3, y: 4 }],
  ]);
  assert.equal(drawnPositions({}, stored), stored);
  assert.equal(drawnPositions({ project: { view: { timeAxis: 'horizontal' } } }, stored), stored);
  const vertical = { project: { view: { timeAxis: 'vertical' } } };
  assert.deepEqual(
    [...drawnPositions(vertical, stored)],
    [
      ['a', { x: 2, y: 1 }],
      ['b', { x: 4, y: -3 }],
    ],
  );
  assert.deepEqual(storedPoint(vertical, { x: 2, y: 1 }), { x: 1, y: 2 });
  assert.deepEqual(storedPoint({}, { x: 2, y: 1 }), { x: 2, y: 1 });
  // Stored coordinates are not regenerated.
  assert.deepEqual(
    [...stored.values()],
    [
      { x: 1, y: 2 },
      { x: -3, y: 4 },
    ],
  );
});

/**
 * A network without an axis drawn vertically is the same film as its source
 * with every coordinate swapped: the transpose is the whole difference.
 */
test('a vertical network composes exactly the film of its transposed source', () => {
  const swapped = structuredClone(tang30);
  for (const node of swapped.nodes) node.position = { x: node.position.y, y: node.position.x };
  for (const specName of ['landscape-1080p', 'portrait-1080x1920', 'square-1080']) {
    const a = loaded(project(tang30, 'vertical')),
      b = loaded(structuredClone(swapped));
    const options = { frameSpec: specName, theme: 'light', locale: 'zh-CN' };
    const ra = createHeadlessRenderer(a.graph, layoutGraph(a.graph), {
        ...options,
        detailAt: a.detailAt,
      }),
      rb = createHeadlessRenderer(b.graph, layoutGraph(b.graph), {
        ...options,
        detailAt: b.detailAt,
      });
    for (const frame of sample(a.graph, FRAME_SPECS[specName].fps))
      assert.deepEqual(ra.displayListAt(frame), rb.displayListAt(frame), `${specName} f${frame}`);
  }
});

test('a vertical timeline draws its bars down the frame and its axis across it', () => {
  const doc = loaded(project(dynasties, 'vertical'));
  const positions = layoutGraph(doc.graph);
  for (const specName of Object.keys(FRAME_SPECS)) {
    const spec = FRAME_SPECS[specName];
    const renderer = createHeadlessRenderer(doc.graph, positions, {
      frameSpec: specName,
      theme: 'dark',
      locale: 'zh-CN',
      detailAt: doc.detailAt,
    });
    const bars = new Set(
      doc.graph.nodes
        .filter(
          (node) =>
            glyphGeometry(node, 1, spec, renderer.style, 1, doc.graph.project).shape === 'span',
        )
        .map((node) => node.id),
    );
    assert.ok(bars.size > 0, `${specName}: the timeline keeps its bars`);
    let labelled = 0;
    for (const frame of sample(doc.graph, spec.fps)) {
      const list = renderer.displayListAt(frame);
      assert.deepEqual(
        timeDirectionProblems(list, spec, VIDEO_THEMES.dark, measure, {
          vertical: true,
          positions,
          bars,
        }),
        [],
        `${specName} f${frame}`,
      );
      const axis = readTimeAxis(list, VIDEO_THEMES.dark);
      if (axis.labels.length >= 2) labelled++;
      // Earlier is higher: a bar that begins and ends earlier starts and
      // ends higher up (bars as short as they are wide keep their width).
      const boxes = new Map(
        list.selection.filter((e) => e.kind === 'node' && e.box).map((e) => [e.id, e.box]),
      );
      const shown = doc.graph.nodes.filter((n) => bars.has(n.id) && boxes.has(n.id));
      for (const a of shown)
        for (const b of shown) {
          const [ba, bb] = [boxes.get(a.id), boxes.get(b.id)];
          if (a.span.from < b.span.from && (a.span.to ?? Infinity) < (b.span.to ?? Infinity))
            assert.ok(
              ba.y < bb.y && ba.y + ba.h < bb.y + bb.h,
              `${specName} f${frame}: ${a.id} is earlier than ${b.id}`,
            );
        }
    }
    assert.ok(labelled > 0, `${specName}: the axis labels its rules`);
  }
});

test('relgraph render warns when a portrait spec draws a horizontal time axis', () => {
  const plain = loaded(structuredClone(dynasties)).graph;
  const upright = loaded(project(dynasties, 'vertical')).graph;
  const network = loaded(structuredClone(tang64)).graph;
  const at = (graph, spec) => timeAxisWarning(graph, layoutGraph(graph), FRAME_SPECS[spec]);
  for (const spec of ['portrait-1080x1920', 'portrait-1080x1440'])
    assert.match(at(plain, spec) ?? '', /config\.view\.timeAxis/, spec);
  for (const spec of ['landscape-1080p', 'landscape-720p', 'square-1080'])
    assert.equal(at(plain, spec), null, spec);
  for (const spec of Object.keys(FRAME_SPECS)) {
    assert.equal(at(upright, spec), null, `vertical ${spec}`);
    // A network draws no axis, whatever its x means.
    assert.equal(at(network, spec), null, `network ${spec}`);
  }
});

test('the chronology check reads time along the direction it is drawn in', () => {
  const doc = {
    format: 'relgraph.graph/1',
    nodes: [
      { id: 'early', visibleFrom: 0, position: { x: 0, y: 0 } },
      { id: 'late', visibleFrom: 100, position: { x: 300, y: -200 } },
    ],
    presentation: [{ title: 'all', durationSec: 2, domainAt: 100 }],
  };
  for (const timeAxis of ['horizontal', 'vertical']) {
    const { graph } = loaded(project(doc, timeAxis));
    const stored = layoutGraph(graph);
    // Drawn either way, the earlier node comes first along time.
    assert.deepEqual(chronologyInversions(graph, stored, 10), [], timeAxis);
  }
  const inverted = structuredClone(doc);
  inverted.nodes[0].position = { x: 500, y: 0 };
  const { graph } = loaded(project(inverted, 'vertical'));
  assert.equal(chronologyInversions(graph, layoutGraph(graph), 10).length, 1);
});

test('check-layout runs on the transposed Tang 64 drawing', async () => {
  const file = 'output/time-direction/tang64.vertical.studio.json';
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('output/time-direction', { recursive: true });
  writeFileSync(file, JSON.stringify(project(tang64, 'vertical')));
  const summary = await checkLayout({
    file,
    frameSpec: 'portrait-1080x1920',
    locale: 'zh-CN',
    chronologyTolerance: 20,
  });
  assert.equal(summary.chronology.inversions.length, 0);
  assert.equal(summary.chronology.timedNodes, 64);
  assert.equal(summary.chronology.direction, 'vertical');
  // Order is read along time as drawn: down the frame.
  assert.match(formatLayoutIssues(summary), /两点在纵向上没有先后颠倒/);
}, 120_000);

test('engines read a target aspect, and keep the landscape one without it', () => {
  const graph = {
    nodes: Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, kind: 'k', label: `n${i}` })),
    edges: [],
  };
  const extent = (positions) => {
    const xs = [...positions.values()].map((p) => p.x),
      ys = [...positions.values()].map((p) => p.y);
    return (Math.max(...xs) - Math.min(...xs)) / Math.max(1, Math.max(...ys) - Math.min(...ys));
  };
  const options = { seed: 0, spacing: 150, iterations: 300 };
  const wide = runLayoutEngine(graph, 'grid', options);
  assert.deepEqual(runLayoutEngine(graph, 'grid', { ...options, aspect: undefined }), wide);
  const tall = runLayoutEngine(graph, 'grid', { ...options, aspect: 0.5 });
  assert.ok(extent(wide) > 1.5, `landscape grid ${extent(wide)}`);
  assert.ok(extent(tall) < 1, `portrait grid ${extent(tall)}`);
  // A portrait film drawing time downward wants its world drawing wide:
  // the drawn aspect is the graph area's, transposed.
  const portrait = FRAME_SPECS['portrait-1080x1920'];
  const area = portrait.safe.graph.w / portrait.safe.graph.h;
  assert.equal(engineAspect(portrait, 'horizontal'), area);
  assert.equal(engineAspect(portrait, 'vertical'), 1 / area);
  assert.equal(engineAspect(FRAME_SPECS['landscape-1080p'], 'horizontal'), undefined);
});

test('a timeline computed for a vertical portrait film spreads its lanes', () => {
  const { graph } = loaded(project(dynasties, 'vertical'));
  const settings = { ...DEFAULT_LAYOUT_SETTINGS, type: 'timeline', mode: 'rearrange' };
  const lanes = (positions) => new Set([...positions.values()].map((p) => p.y));
  const height = (positions) => {
    const ys = [...positions.values()].map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  };
  const landscape = planLayout(graph, settings).positions;
  const aspect = engineAspect(FRAME_SPECS['portrait-1080x1920'], 'vertical');
  const portrait = planLayout(graph, settings, undefined, { aspect }).positions;
  // Same years, same lanes in the same order, further apart.
  for (const [id, p] of landscape) assert.equal(portrait.get(id).x, p.x, id);
  assert.equal(lanes(portrait).size, lanes(landscape).size);
  assert.ok(height(portrait) > height(landscape), `${height(portrait)} > ${height(landscape)}`);
  assert.deepEqual(planLayout(graph, settings, undefined, {}).positions, landscape);
});

/** Names the composer could not place on the final overview, at a spec. */
function overviewOmissions(doc, specName) {
  const { graph, detailAt } = loaded(doc);
  const spec = FRAME_SPECS[specName];
  const renderer = createHeadlessRenderer(graph, layoutGraph(graph), {
    frameSpec: specName,
    theme: 'light',
    locale: 'zh-CN',
    detailAt,
  });
  return renderer.displayListAt(frameCount(graph, spec.fps) - 1).omitted.length;
}

test('the Tang 64 overview is more legible upright in portrait', () => {
  const report = {};
  for (const spec of ['portrait-1080x1920', 'portrait-1080x1440']) {
    const across = overviewOmissions(structuredClone(tang64), spec),
      upright = overviewOmissions(project(tang64, 'vertical'), spec);
    report[spec] = { across, upright };
  }
  // Numbers recorded in the ADR's design note.
  const expected = JSON.parse(
    readFileSync(new URL('./fixtures/tang64-overview-omissions.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(report, expected);
  assert.ok(
    report['portrait-1080x1920'].upright < report['portrait-1080x1920'].across,
    JSON.stringify(report),
  );
}, 120_000);

/** A timeline of two eras in two groups, joined by a relation. */
const linked = {
  format: 'relgraph.graph/1',
  diagram: 'timeline',
  groups: [{ id: 'g1' }, { id: 'g2' }],
  nodes: [
    // Lanes far apart, so the relation is an elbow whichever way time runs.
    { id: 'a', label: '前朝', start: 0, end: 40, group: 'g1', position: { y: 0 } },
    { id: 'b', label: '后朝', start: 50, end: 100, group: 'g2', position: { y: 600 } },
  ],
  edges: [{ id: 'r', source: 'a', target: 'b' }],
  presentation: [{ id: 'all', title: '全', durationSec: 3, domainAt: 100 }],
};

test('a timeline relation leaves its bar along time, and the legend bar runs with time', () => {
  for (const timeAxis of ['horizontal', 'vertical']) {
    const { graph } = loaded(project(linked, timeAxis === 'vertical' ? 'vertical' : undefined));
    const renderer = createHeadlessRenderer(graph, layoutGraph(graph), {
      frameSpec: 'portrait-1080x1920',
      theme: 'dark',
      locale: 'zh-CN',
    });
    const list = renderer.displayListAt(frameCount(graph, 24) - 1);
    const edge = list.selection.find((entry) => entry.kind === 'edge' && entry.id === 'r');
    assert.ok(edge, timeAxis);
    const [p0, p1] = edge.points;
    const [along, across] =
      timeAxis === 'vertical'
        ? [Math.abs(p1.y - p0.y), Math.abs(p1.x - p0.x)]
        : [Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)];
    // An elbow leaves along time: level when time runs across, upright when down.
    assert.ok(across < along * 0.2, `${timeAxis}: leaves at ${across} across, ${along} along`);
  }
  for (const timeAxis of ['horizontal', 'vertical']) {
    const { graph } = loaded(project(dynasties, timeAxis === 'vertical' ? 'vertical' : undefined));
    const renderer = createHeadlessRenderer(graph, layoutGraph(graph), {
      frameSpec: 'portrait-1080x1920',
      theme: 'dark',
      locale: 'zh-CN',
    });
    const list = renderer.displayListAt(frameCount(graph, 24) - 1);
    const items = [];
    (function walk(entries) {
      for (const item of entries) item.type === 'group' ? walk(item.items) : items.push(item);
    })(list.items);
    const plates = items
      .filter((item) => item.type === 'path' && item.fill === VIDEO_THEMES.dark.legendPlate)
      .map((item) => ({ x: item.d[0][1], y: item.d[0][2], w: item.d[0][3], h: item.d[0][4] }));
    const marks = items.filter(
      (item) =>
        item.type === 'path' &&
        item.fill !== VIDEO_THEMES.dark.legendPlate &&
        item.d.length === 1 &&
        item.d[0][0] === 'RR' &&
        plates.some(
          (plate) =>
            item.d[0][1] >= plate.x &&
            item.d[0][2] >= plate.y &&
            item.d[0][1] + item.d[0][3] <= plate.x + plate.w &&
            item.d[0][2] + item.d[0][4] <= plate.y + plate.h,
        ),
    );
    assert.ok(marks.length > 0, `${timeAxis}: the legend shows bars`);
    for (const mark of marks) {
      const [w, h] = [mark.d[0][3], mark.d[0][4]];
      assert.ok(timeAxis === 'vertical' ? h > w : w > h, `${timeAxis}: legend bar ${w}×${h}`);
    }
  }
});

test('with time running down, no axis label is left under the evidence card', () => {
  // One shot framing an early era whose card it shows: the later years run
  // on down the stage, under the card below the graph.
  const doc = structuredClone(dynasties);
  const cited = doc.nodes.find((node) => node.id === '东汉');
  cited.evidence = [{ cite: '某书', locator: '卷一', quote: '一朝一代，各有始终。' }];
  doc.presentation = [
    {
      id: 'era',
      title: '东汉',
      durationSec: 6,
      domainAt: 1912,
      camera: { focusNodeId: cited.id },
      evidence: { nodeId: cited.id },
    },
  ];
  for (const specName of ['portrait-1080x1920', 'portrait-1080x1440']) {
    const spec = FRAME_SPECS[specName];
    const { graph } = loaded(project(doc, 'vertical'));
    const positions = layoutGraph(graph);
    const renderer = createHeadlessRenderer(graph, positions, {
      frameSpec: specName,
      theme: 'dark',
      locale: 'zh-CN',
    });
    // While the card is fully shown: after the camera settles, before the caption fades.
    const list = renderer.displayListAt(Math.round(4.5 * spec.fps));
    assert.ok(
      readFrame(list, VIDEO_THEMES.dark, measure).cards.evidence,
      `${specName}: card drawn`,
    );
    assert.equal(list.evidenceOverflow, null, specName);
    assert.equal(list.evidenceCovers, null, specName);
    const drawn = readTimeAxis(list, VIDEO_THEMES.dark);
    assert.ok(drawn.labels.length > 0, `${specName}: the axis is labelled`);
    const problems = timeDirectionProblems(list, spec, VIDEO_THEMES.dark, measure, {
      vertical: true,
      positions,
    });
    assert.ok(
      problems.some((p) => /evidence card/.test(p)) === false,
      `${specName}: ${problems.join('; ')}`,
    );
    assert.deepEqual(problems, [], specName);
  }
});
