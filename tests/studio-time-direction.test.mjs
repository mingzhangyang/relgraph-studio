// The studio's time-axis control (ADR 004, D7 step 2), driven through the
// shared simulated DOM (not a browser): the direction is a project field,
// committed, undone, redone and saved with the rest of `config`, never
// changed by the preview's frame spec, offered only for graphs with times,
// and a drag on a vertical drawing moves the stored point it stands for.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { VIDEO_THEMES } from '../packages/render/src/theme.ts';
import { deferred, flush, makeStudio } from './helpers/studio-harness.mjs';
import { measure } from './helpers/display-list.mjs';
import { timeDirectionProblems } from './helpers/time-direction.mjs';

async function timelineStudio() {
  let last = null;
  const app = makeStudio({ onRenderFrame: (rendered) => (last = rendered) });
  await app.ready;
  await app.node('exampleTimeline').click();
  await flush();
  return { app, last: () => last };
}
const direction = (rendered) => rendered.graph.project?.view?.timeAxis ?? 'horizontal';
const drawnVertically = (rendered) =>
  timeDirectionProblems(rendered.list, { typeScale: 1, safe: {} }, VIDEO_THEMES.dark, measure, {
    vertical: true,
    positions: rendered.positions,
  }).length === 0;

test('the time axis is a project field: committed, undone, redone and saved', async () => {
  const { app, last } = await timelineStudio();
  const select = app.node('timeAxisSelect');
  assert.equal(select.disabled, false, 'a timeline has times');
  assert.equal(select.value, 'horizontal');
  assert.equal(direction(last()), 'horizontal');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');

  select.value = 'vertical';
  await select.dispatch('change');
  assert.equal(direction(last()), 'vertical');
  assert.ok(drawnVertically(last()), 'the preview is drawn transposed');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  await app.node('visualUndo').click();
  assert.equal(select.value, 'horizontal');
  assert.equal(direction(last()), 'horizontal');
  await app.node('visualRedo').click();
  assert.equal(select.value, 'vertical');
  assert.equal(direction(last()), 'vertical');

  // The preview's frame spec never changes the direction, either way.
  const spec = app.node('frameSpecSelect');
  for (const name of ['portrait-1080x1920', 'landscape-720p']) {
    spec.value = name;
    await spec.dispatch('change');
    assert.equal(select.value, 'vertical', name);
    assert.equal(direction(last()), 'vertical', name);
  }

  await app.node('visualSave').click();
  assert.match(app.downloads.at(-1).filename, /\.studio\.json$/);
  const saved = JSON.parse(await app.blobs.at(-1).text());
  assert.deepEqual(saved.config.view, { timeAxis: 'vertical' });
  const reloaded = loadDocument(saved);
  assert.equal(reloaded.valid, true);
  assert.equal(reloaded.graph.project.view.timeAxis, 'vertical');

  // Back to horizontal writes no field: a horizontal project is as before.
  select.value = 'horizontal';
  await select.dispatch('change');
  await app.node('visualSave').click();
  assert.equal(JSON.parse(await app.blobs.at(-1).text()).config.view, undefined);
});

test('the control is offered only for a graph whose nodes carry times', async () => {
  const app = makeStudio();
  await app.ready;
  await app.node('exampleGraph').click();
  await flush();
  const select = app.node('timeAxisSelect');
  assert.equal(select.disabled, true);
  assert.equal(select.value, 'horizontal');
  await app.node('exampleTimeline').click();
  await flush();
  assert.equal(select.disabled, false);
});

test('changing direction exits position editing on commit, undo and redo', async () => {
  const { app, last } = await timelineStudio();
  const toggle = app.node('layoutToggle');
  const select = app.node('timeAxisSelect');
  const horizontal = last().state.cameraResolved;
  for (const action of ['change', 'visualUndo', 'visualRedo']) {
    await toggle.click();
    assert.equal(toggle.attributes['aria-pressed'], 'true');
    if (action === 'change') {
      select.value = 'vertical';
      await select.dispatch('change');
    } else await app.node(action).click();
    assert.equal(toggle.attributes['aria-pressed'], 'false', action);
    const camera = last().state.cameraResolved;
    if (action === 'visualUndo') assert.deepEqual(camera, horizontal);
    else assert.deepEqual([camera.x, camera.y], [horizontal.y, horizontal.x]);
  }
});

test('a pending replacement immediately disables the time-axis menu', async () => {
  const { app } = await timelineStudio();
  const input = app.node('fileInput');
  const select = app.node('timeAxisSelect');
  const pending = deferred();
  input.files = [{ name: 'replacement.json', text: () => pending.promise }];
  await input.dispatch('change');
  assert.equal(select.disabled, true);
  pending.resolve(
    JSON.stringify({ format: 'relgraph.graph/1', nodes: [{ id: 'a', visibleFrom: 1 }] }),
  );
  await flush();
  assert.equal(select.disabled, false);
});

test('a drag on a vertical timeline changes the lane, never the years', async () => {
  const { app, last } = await timelineStudio();
  const select = app.node('timeAxisSelect');
  select.value = 'vertical';
  await select.dispatch('change');
  await app.node('layoutToggle').click();
  const rendered = last();
  const stage = app.node('stage');
  const scale = rendered.state.cameraResolved.scale;
  const hit = rendered.list.selection.find((entry) => entry.kind === 'node' && entry.box);
  assert.ok(hit, 'a node is drawn');
  const before = rendered.positions.get(hit.id);
  const at = { x: hit.box.x + hit.box.w / 2, y: hit.box.y + hit.box.h / 2 };
  await stage.dispatch('pointerdown', {
    pointerId: 7,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    clientX: at.x,
    clientY: at.y,
  });
  assert.equal(stage.pointerCaptured, 7, `grabbed ${hit.id}`);
  // Across the screen and down it: across is the stored lane (y); down is
  // the stored x, a date on an anchored timeline, which a drag never moves.
  await stage.dispatch('pointermove', { pointerId: 7, clientX: at.x + 40, clientY: at.y + 25 });
  await stage.dispatch('pointerup', { pointerId: 7, clientX: at.x + 40, clientY: at.y + 25 });
  const after = last().positions.get(hit.id);
  assert.equal(after.x, before.x, 'the years stay');
  assert.ok(Math.abs(after.y - (before.y + 40 / scale)) < 0.02, `${after.y} vs ${before.y}`);
});
