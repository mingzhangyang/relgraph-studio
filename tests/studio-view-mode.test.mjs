// The studio's 画面形式 control (`config.view.mode`), driven through the
// shared simulated DOM (not a browser): the form is a project field,
// committed, undone, redone and saved with the rest of `config`, kept beside
// the direction of time, and the preview composes list rows when it is set.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadDocument } from '../packages/core/src/director/load.ts';
import { flush, makeStudio } from './helpers/studio-harness.mjs';

async function timelineStudio() {
  let last = null;
  const app = makeStudio({ onRenderFrame: (rendered) => (last = rendered) });
  await app.ready;
  await app.node('exampleTimeline').click();
  await flush();
  return { app, last: () => last };
}
const mode = (rendered) => rendered.graph.project?.view?.mode ?? 'graph';
/** A list frame selects rows by box; a drawing selects glyphs by outline. */
const drawsRows = (rendered) =>
  rendered.list.selection.length > 0 &&
  rendered.list.selection.every((entry) => entry.box && !entry.outline);

test('the view mode is a project field: committed, undone, redone and saved', async () => {
  const { app, last } = await timelineStudio();
  const select = app.node('viewModeSelect');
  assert.equal(select.disabled, false);
  assert.equal(select.value, 'graph');
  assert.equal(mode(last()), 'graph');
  assert.equal(drawsRows(last()), false);

  select.value = 'list';
  await select.dispatch('change');
  assert.equal(mode(last()), 'list');
  assert.ok(drawsRows(last()), 'the preview composes list rows');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  await app.node('visualUndo').click();
  assert.equal(select.value, 'graph');
  assert.equal(mode(last()), 'graph');
  await app.node('visualRedo').click();
  assert.equal(select.value, 'list');
  assert.equal(mode(last()), 'list');

  // The direction of time is kept beside the form, and the form beside it.
  const axis = app.node('timeAxisSelect');
  axis.value = 'vertical';
  await axis.dispatch('change');
  await app.node('visualSave').click();
  let saved = JSON.parse(await app.blobs.at(-1).text());
  assert.deepEqual(saved.config.view, { mode: 'list', timeAxis: 'vertical' });
  const reloaded = loadDocument(saved);
  assert.equal(reloaded.valid, true, JSON.stringify(reloaded.errors));
  assert.equal(reloaded.graph.project.view.mode, 'list');

  axis.value = 'horizontal';
  await axis.dispatch('change');
  await app.node('visualSave').click();
  saved = JSON.parse(await app.blobs.at(-1).text());
  assert.deepEqual(saved.config.view, { mode: 'list' }, 'turning the axis back keeps the form');

  // Back to the drawing writes no field: such a project is as before.
  select.value = 'graph';
  await select.dispatch('change');
  await app.node('visualSave').click();
  assert.equal(JSON.parse(await app.blobs.at(-1).text()).config.view, undefined);
});

test('the control is offered for every loaded graph, with or without times', async () => {
  const app = makeStudio();
  await app.ready;
  await app.node('exampleGraph').click();
  await flush();
  assert.equal(app.node('viewModeSelect').disabled, false);
});
