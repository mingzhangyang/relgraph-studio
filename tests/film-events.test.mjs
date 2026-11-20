// Film events, relgraph.events/1 (ADR 004, D3): every event lands on the
// frame the renderer shows it, the file is spoiler-safe because it is read
// from the projected timeline, and ids are the source's own.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from '../examples/manifest.json' with { type: 'json' };
import { loadDocument } from '../packages/core/src/director/load.ts';
import { layoutGraph } from '../packages/core/src/director/layout.ts';
import { directorFrameAt, frameCount } from '../packages/core/src/director/state.ts';
import {
  compileTimeline,
  frameAtOrAfter,
  shotStartFrames,
  timelinePlaybackAt,
} from '../packages/core/src/director/timeline.ts';
import { filmEvents, formatFilmEvents } from '../packages/core/src/director/events.ts';
import { createHeadlessRenderer } from '../packages/render/src/backends/skia.ts';
import { settledFrameRanges } from '../packages/cli/src/labels.ts';
import { exportEvents, graphEvents } from '../packages/cli/src/events.ts';
import { main } from '../packages/cli/src/index.ts';
import { parseCommand, UsageError } from '../packages/cli/src/args.ts';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const TANG = ['30', '64'].map((n) => `../datasets/tang-poets-met/唐代诗人见面网络_${n}.graph.json`);

/**
 * Fractional and sub-frame shots, a highlight of a node that is not yet
 * visible, and domain time going back (乙 and its relation leave) and
 * forward again (they return, with new reveals).
 */
const edgeCase = {
  format: 'relgraph.graph/1',
  timeline: { unit: '年' },
  groups: [{ id: '前期' }, { id: '后期' }],
  nodes: [
    { id: '甲', group: '前期', visibleFrom: 1, position: { x: 0, y: 0 } },
    { id: '乙', group: '前期', visibleFrom: 5, position: { x: 300, y: 0 } },
    { id: '丙', group: '后期', visibleFrom: 6, position: { x: 150, y: 200 } },
    { id: '丁', group: '后期', visibleFrom: 50, position: { x: 400, y: 300 } },
  ],
  edges: [
    { id: '甲—乙', source: '甲', target: '乙', visibleFrom: 5 },
    { source: '乙', target: '丙', visibleFrom: 6 },
  ],
  presentation: [
    { id: 'open', title: '开场', durationSec: 1.1, domainAt: 1, highlight: { nodeIds: ['乙'] } },
    { id: 'meet', title: '相识', durationSec: 0.7, domainAt: 5, highlight: { nodeIds: ['乙'] } },
    { id: 'blink', title: '一闪', durationSec: 0.01, domainAt: 6 },
    { id: 'back', title: '回到从前', durationSec: 1 / 3, domainAt: 2 },
    { id: 'later', title: '后来', durationSec: 2.05, domainAt: 6, transitionMs: 300 },
  ],
};

/**
 * Domain time 5 → 1 → 5 with the step back shorter than a frame (ADR 004,
 * D3 review): frames 26 and 27 both project 甲, so 甲 never leaves the
 * screen and is revealed once. 乙 is withdrawn for good by a shot with frames.
 */
const subFrameStepBack = {
  format: 'relgraph.graph/1',
  nodes: [
    { id: '甲', visibleFrom: 3, position: { x: 0, y: 0 } },
    { id: '乙', visibleFrom: 4, position: { x: 200, y: 0 } },
    { id: '丙', position: { x: 100, y: 100 } },
  ],
  edges: [{ id: '甲—丙', source: '甲', target: '丙', visibleFrom: 3 }],
  presentation: [
    { id: 'a', title: '五', durationSec: 1.1, domainAt: 5 },
    { id: 'blink', title: '一', durationSec: 0.01, domainAt: 1 },
    { id: 'b', title: '五', durationSec: 2, domainAt: 5 },
    { id: 'c', title: '三', durationSec: 1, domainAt: 3 },
  ],
};

const DOCUMENTS = [
  ...manifest.map((entry) => ({ name: entry.file, source: read(`../examples/${entry.file}`) })),
  ...TANG.map((path) => ({ name: path.split('/').at(-1), source: read(path) })),
  { name: 'edge case', source: edgeCase },
  { name: 'sub-frame step back', source: subFrameStepBack },
];

function load(source) {
  const result = loadDocument(source);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}

/** Authored id → internal id, the inverse of `authoredIds`. */
function internal(result) {
  const maps = {};
  for (const kind of ['nodes', 'edges', 'groups', 'scenes'])
    maps[kind] = new Map([...(result.authoredIds?.[kind] ?? [])].map(([id, raw]) => [raw, id]));
  return (kind, id) => maps[kind].get(id) ?? id;
}

function film(source, fps = 24) {
  const result = load(source);
  const timeline = compileTimeline(result.graph, fps);
  const positions = layoutGraph(result.graph);
  const events = filmEvents(result.graph, positions, fps, {
    timeline,
    authoredIds: result.authoredIds,
  });
  const at = (frame) => directorFrameAt(result.graph, positions, frame, fps, { timeline });
  return { result, timeline, positions, events, at, id: internal(result) };
}

test('shot events cover exactly the frames timelinePlaybackAt gives each shot', () => {
  for (const { name, source } of DOCUMENTS)
    for (const fps of [24, 25, 30]) {
      const { result, timeline, events } = film(source, fps);
      const shots = events.events.filter((event) => event.type === 'shot');
      // Every shot a frame shows has its event; a shot no frame shows has none.
      const starts = shotStartFrames(timeline);
      const shown = timeline.shots.flatMap((_, index) => {
        const next = index === timeline.shots.length - 1 ? events.frameCount : starts[index + 1];
        return next > starts[index] ? [index] : [];
      });
      assert.deepEqual(
        shots.map((shot) => shot.shot),
        shown,
        name,
      );
      assert.equal(events.frameCount, frameCount(result.graph, fps));
      assert.equal(shots[0].frame, 0);
      assert.equal(shots.at(-1).lastFrame, events.frameCount - 1);
      for (const [index, shot] of shots.entries()) {
        assert.ok(shot.frames > 0);
        assert.equal(shot.frames, shot.lastFrame - shot.frame + 1);
        if (index)
          assert.equal(shot.frame, shots[index - 1].lastFrame + 1, `${name} shot ${index}`);
      }
      const byIndex = new Map(shots.map((shot) => [shot.shot, shot]));
      for (let frame = 0; frame < events.frameCount; frame += 1) {
        const shot = byIndex.get(timelinePlaybackAt(timeline, frame / fps).index);
        assert.ok(shot, `${name}@${fps}: frame ${frame} has a shot event`);
        assert.ok(shot.frame <= frame && frame <= shot.lastFrame, `${name}@${fps}: frame ${frame}`);
      }
      // Settled frames are the ones the label and layout checks sample.
      const ranges = settledFrameRanges(timeline, events.frameCount);
      for (const shot of shots)
        assert.equal(
          shot.settledFrame,
          ranges[shot.shot].first <= ranges[shot.shot].last ? ranges[shot.shot].first : null,
          `${name} shot ${shot.shot} settles`,
        );
    }
});

test('a reveal event is the first frame its object is drawn from; the frame before cannot show it', () => {
  for (const { name, source } of DOCUMENTS) {
    const { timeline, events, at, id } = film(source);
    const reveals = events.events.filter((event) => event.type === 'reveal');
    assert.ok(reveals.length, name);
    for (const event of reveals) {
      const kind = event.object === 'node' ? 'nodes' : 'edges';
      const target = id(kind, event.id);
      const where = `${name}: ${event.object} ${event.id} @${event.frame}`;
      const state = at(event.frame);
      assert.ok(
        state.view[kind].some((item) => item.id === target),
        `${where} is projected`,
      );
      const progress = state.reveal[kind][target];
      if (event.effect === 'none') {
        assert.equal(event.frame, 0, where);
        assert.equal(progress, 1, `${where} shown outright`);
      } else {
        assert.ok(event.frame > 0, where);
        assert.ok(progress >= 0 && progress < 1, `${where} starts its ${event.effect}`);
        assert.ok(
          progress < 1 / (timeline.fps * event.durationSec) + 1e-9,
          `${where} at most one frame into it (${progress})`,
        );
        const before = at(event.frame - 1);
        assert.ok(
          !before.view[kind].some((item) => item.id === target),
          `${where} not projected the frame before`,
        );
        // Drawing (opacity or stroke above 0) starts on the frame or the next.
        const next = at(event.frame + 1).reveal[kind][target];
        assert.ok(progress > 0 || next > 0, `${where} drawn by the next frame`);
      }
      if (event.outFrame !== undefined) {
        assert.ok(!at(event.outFrame).view[kind].some((item) => item.id === target), where);
        assert.ok(
          at(event.outFrame - 1).view[kind].some((item) => item.id === target),
          where,
        );
      }
    }
  }
});

test('composed frames agree: a revealed node is in the frame text from its event, not before', () => {
  // The DisplayList's accessible text lists exactly the projected nodes, and
  // glyphs enter the hit geometry once past half their reveal.
  for (const path of [TANG[1]]) {
    const { result, events, id, positions } = film(read(path));
    const renderer = createHeadlessRenderer(result.graph, positions, {
      detailAt: result.detailAt,
      frameSpec: 'landscape-720p',
    });
    const label = new Map(events.nodes.map((node) => [node.id, node.label]));
    for (const event of events.events)
      if (event.type === 'reveal' && event.object === 'node' && event.frame > 0) {
        const name = label.get(event.id);
        assert.ok(!renderer.displayListAt(event.frame - 1).a11y.nodes.includes(name), name);
        assert.ok(renderer.displayListAt(event.frame).a11y.nodes.includes(name), name);
        const half = frameAtOrAfter(event.sec + event.durationSec / 2 + 1e-6, events.fps);
        const hit = (frame) =>
          renderer
            .displayListAt(frame)
            .selection.some((item) => item.kind === 'node' && item.id === id('nodes', event.id));
        assert.ok(hit(half), `${name} hit at ${half}`);
        assert.ok(!hit(event.frame - 1), `${name} no hit at ${event.frame - 1}`);
      }
  }
});

test('events are spoiler-safe: nothing appears before the projection shows it', () => {
  const { events } = film(edgeCase);
  const [open, meet] = events.events.filter((event) => event.type === 'shot');
  // The opening highlights 乙, which is not yet visible: the shot is redacted.
  assert.equal(open.redacted, true);
  assert.equal(open.id, null);
  assert.deepEqual(open.highlight.nodeIds, []);
  assert.doesNotMatch(JSON.stringify(events.events.filter((e) => e.shot === 0)), /乙/);
  assert.equal(meet.redacted, false);
  assert.deepEqual(meet.highlight.nodeIds, ['乙']);
  // 丁 is never visible: not in the node table, no event names it.
  assert.deepEqual(
    events.nodes.map((node) => node.id),
    ['甲', '乙', '丙'],
  );
  assert.doesNotMatch(formatFilmEvents(events), /丁/);

  const reveals = events.events
    .filter((event) => event.type === 'reveal')
    .map((e) => `${e.object}:${e.id}@${e.shot}${e.outFrame === undefined ? '' : `→${e.outFrame}`}`);
  // 乙 and 甲—乙 arrive in shot 1 and leave when time goes back (shot 3, frame
  // 44); everything returns in shot 4. 丙 and the relation 乙—丙 enter in the
  // shot that lasts less than a frame and leave on the frame it would have
  // started: no frame shows them there, so no event either.
  const named = reveals.map((r) => r.replace(/x-[0-9a-f]+:x-[0-9a-f]+/, '乙:丙'));
  assert.deepEqual(named, [
    'node:甲@0',
    'node:乙@1→44',
    'edge:甲—乙@1→44',
    'node:乙@4',
    'node:丙@4',
    'edge:甲—乙@4',
    'edge:乙:丙@4',
  ]);
  const edge = events.events.find((e) => e.type === 'reveal' && e.id === '甲—乙');
  assert.deepEqual(
    { source: edge.source, target: edge.target, group: edge.group, kind: edge.kind },
    { source: '甲', target: '乙', group: '前期', kind: 'link' },
  );
  // A relation the source leaves unnamed keeps its generated id; its ends are the source's.
  const unnamed = events.events.find(
    (e) => e.type === 'reveal' && e.object === 'edge' && e.source === '乙' && e.target === '丙',
  );
  assert.equal(unnamed.group, null, 'ends in different groups');

  // The sub-frame shot has no event at all: the frames go from 5 straight back to 2.
  assert.deepEqual(
    events.events.filter((e) => e.shot === 2),
    [],
  );
  assert.deepEqual(
    events.events
      .filter((e) => e.type === 'domain-time')
      .map((e) => [e.shot, e.previous, e.value, e.unit]),
    [
      [0, null, 1, '年'],
      [1, 1, 5, '年'],
      [3, 5, 2, '年'],
      [4, 2, 6, '年'],
    ],
  );
});

test('a withdrawal no frame shows is neither an exit nor a second entrance', () => {
  const { events, at, id } = film(subFrameStepBack);
  const shots = events.events.filter((e) => e.type === 'shot');
  assert.deepEqual(
    shots.map((e) => [e.id, e.frame, e.frames]),
    [
      ['a', 0, 27],
      ['b', 27, 48],
      ['c', 75, 24],
    ],
  );
  for (const frame of [26, 27]) {
    const view = at(frame).view;
    assert.ok(
      view.nodes.some((node) => node.id === id('nodes', '甲')),
      `甲 projected at ${frame}`,
    );
    assert.ok(
      view.edges.some((edge) => edge.id === id('edges', '甲—丙')),
      `甲—丙 at ${frame}`,
    );
  }
  const reveals = events.events
    .filter((e) => e.type === 'reveal')
    .map((e) => `${e.id}@${e.frame}${e.outFrame === undefined ? '' : `→${e.outFrame}`}`);
  assert.deepEqual(reveals, ['甲@0', '乙@0→75', '丙@0', '甲—丙@0']);
  // Domain time as the frames show it: 5, then 3; the step to 1 is never on screen.
  assert.deepEqual(
    events.events.filter((e) => e.type === 'domain-time').map((e) => [e.frame, e.value]),
    [
      [0, 5],
      [75, 3],
    ],
  );
});

test('a shot no frame shows names nothing: no id, title or highlight of what only it projects', () => {
  // 丙 is visible only at domain time 5, which only the 0.01 s shot sets,
  // and that shot highlights it: a projection the film never shows.
  const doc = {
    format: 'relgraph.graph/1',
    nodes: [
      { id: '甲', visibleFrom: 1, position: { x: 0, y: 0 } },
      { id: '乙', visibleFrom: 1, position: { x: 200, y: 0 } },
      { id: '丙', visibleFrom: 5, position: { x: 100, y: 150 } },
    ],
    edges: [{ id: '乙—丙', source: '乙', target: '丙', visibleFrom: 5 }],
    presentation: [
      { id: 'early', title: '起初', durationSec: 1.1, domainAt: 1 },
      {
        id: 'secret-bing',
        title: '丙登场',
        narration: '丙与乙相识',
        durationSec: 0.01,
        domainAt: 5,
        highlight: { nodeIds: ['丙'], edgeIds: ['乙—丙'] },
      },
      { id: 'again', title: '回到起初', durationSec: 2, domainAt: 1 },
    ],
  };
  const { timeline, events } = film(doc);
  // The compiled shot does project and highlight 丙 (unredacted)…
  assert.equal(timeline.shots[1].scene.redacted, false);
  assert.ok(timeline.shots[1].view.nodes.some((node) => node.label === '丙'));
  // …but no frame shows that shot, so the events never mention it.
  assert.deepEqual(
    events.events.filter((e) => e.type === 'shot').map((e) => [e.shot, e.id]),
    [
      [0, 'early'],
      [2, 'again'],
    ],
  );
  const text = formatFilmEvents(events);
  for (const hidden of ['丙', '乙—丙', 'secret-bing', '丙登场', '丙与乙相识'])
    assert.ok(!text.includes(hidden), `${hidden} is never shown`);
  assert.deepEqual(
    events.nodes.map((node) => node.id),
    ['甲', '乙'],
  );
});

test('the node table: authored ids, drawn labels, groups and the world coordinates drawn', () => {
  const tang = film(read(TANG[1]));
  assert.equal(tang.events.nodes.length, 64);
  const source = read(TANG[1]);
  for (const node of tang.events.nodes) {
    const authored = source.nodes.find((entry) => entry.id === node.id);
    assert.ok(authored, node.id);
    assert.equal(node.group, authored.group);
    assert.equal(node.label, authored.id);
    assert.deepEqual({ x: node.x, y: node.y }, authored.position);
    assert.deepEqual(tang.positions.get(tang.id('nodes', node.id)), { x: node.x, y: node.y });
  }
  for (const event of tang.events.events)
    if (event.type === 'shot') {
      const shot = source.presentation[event.shot];
      assert.equal(event.id, shot.id);
      assert.deepEqual(event.highlight.nodeIds, shot.highlight?.nodeIds ?? []);
    }
  // Every relation is drawn once, with its source id and ends.
  const relations = tang.events.events.filter((e) => e.type === 'reveal' && e.object === 'edge');
  assert.deepEqual(relations.map((e) => e.id).sort(), source.edges.map((e) => e.id).sort());
  for (const event of relations) {
    const edge = source.edges.find((entry) => entry.id === event.id);
    assert.deepEqual(
      [event.source, event.target, event.kind],
      [edge.source, edge.target, edge.kind],
    );
  }

  // Display copy is what the film draws.
  const project = {
    format: 'relgraph.studio/1',
    source,
    config: { text: { nodes: { [tang.id('nodes', '李白')]: { label: '青莲居士' } } } },
  };
  const copy = film(project).events.nodes.find((node) => node.id === '李白');
  assert.equal(copy.label, '青莲居士');
});

test('events are ordered, deterministic and independent of how they are asked for', async () => {
  for (const { name, source } of DOCUMENTS) {
    const { events } = film(source);
    const rank = { shot: 0, 'domain-time': 1, caption: 2, reveal: 3 };
    for (let i = 1; i < events.events.length; i += 1) {
      const [a, b] = [events.events[i - 1], events.events[i]];
      assert.ok(
        a.frame < b.frame ||
          (a.frame === b.frame &&
            (a.shot < b.shot || (a.shot === b.shot && rank[a.type] <= rank[b.type]))),
        `${name}: event ${i} out of order`,
      );
    }
    for (const event of events.events)
      assert.equal(event.frame, shotStartFrames(film(source).timeline)[event.shot]);
    // A fresh load gives the same bytes.
    assert.equal(formatFilmEvents(film(structuredClone(source)).events), formatFilmEvents(events));
    assert.equal(formatFilmEvents(graphEvents(load(source), 24)), formatFilmEvents(events));
  }

  const dir = mkdtempSync(join(tmpdir(), 'relgraph-events-'));
  const file = join(dir, 'tang.graph.json');
  writeFileSync(file, readFileSync(new URL(TANG[1], import.meta.url)));
  const first = await exportEvents({
    file,
    frameSpec: 'landscape-1080p',
    out: join(dir, 'a.json'),
  });
  const second = await exportEvents({
    file,
    frameSpec: 'landscape-720p',
    out: join(dir, 'b.json'),
  });
  assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), first.text);
  assert.equal(
    readFileSync(join(dir, 'b.json'), 'utf8'),
    first.text,
    '720p and 1080p share 24 fps',
  );
  assert.equal(second.text, first.text);
  assert.equal(first.events.format, 'relgraph.events/1');
  assert.equal(first.events.durationSec, 106);

  const io = () => {
    const out = { stdout: '', stderr: '' };
    return {
      out,
      io: { stdout: (text) => (out.stdout += text), stderr: (text) => (out.stderr += text) },
    };
  };
  const printed = io();
  assert.equal(await main(['events', file], printed.io), 0);
  assert.equal(printed.out.stdout, first.text);
  const written = io();
  assert.equal(await main(['events', file, '--out', join(dir, 'c.json')], written.io), 0);
  assert.match(written.out.stdout, /^事件 228 个 · 节点 64 个 · 2544 帧 · 24 fps\n→ .*c\.json\n$/);
  assert.equal(readFileSync(join(dir, 'c.json'), 'utf8'), first.text);
  const invalid = io();
  writeFileSync(join(dir, 'bad.json'), '{"format": "relgraph.graph/1", "nodes": 3}');
  assert.equal(await main(['events', join(dir, 'bad.json')], invalid.io), 1);
  assert.match(invalid.out.stderr, /^relgraph events：.*文档校验失败，未导出。\n$/s);
});

test('events and audio arguments', () => {
  assert.deepEqual(parseCommand(['events', 'g.json']), {
    command: 'events',
    file: 'g.json',
    frameSpec: 'landscape-1080p',
  });
  assert.deepEqual(
    parseCommand(['events', 'g.json', '--frame-spec', 'landscape-720p', '--out', 'e.json']),
    { command: 'events', file: 'g.json', frameSpec: 'landscape-720p', out: 'e.json' },
  );
  const render = parseCommand([
    'render',
    'g.json',
    '--out',
    'f.mp4',
    '--audio',
    'm.wav',
    '--events',
    'e.json',
  ]);
  assert.equal(render.audio, 'm.wav');
  assert.equal(render.events, 'e.json');
  assert.equal(
    parseCommand(['render', 'g.json', '--frames', 'f%d.png', '--events', 'e.json']).events,
    'e.json',
  );
  for (const argv of [
    ['render', 'g.json', '--frames', 'f%d.png', '--audio', 'm.wav'],
    ['render', 'g.json', '--out', 'f.mp4', '--audio', ''],
    ['render', 'g.json', '--out', 'f.mp4', '--events', ''],
    ['events', 'g.json', '--out', ''],
    ['events', 'g.json', '--theme', 'dark'],
    ['events'],
  ])
    assert.throws(() => parseCommand(argv), UsageError, argv.join(' '));
});
