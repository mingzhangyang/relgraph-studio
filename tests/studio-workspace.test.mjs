import { test } from 'vitest';
import assert from 'node:assert/strict';
import literature from '../examples/honglou-provisional.relgraph.json' with { type: 'json' };
import biology from '../examples/biology-signaling-synthetic.json' with { type: 'json' };
import { deferred, flush, makeStudio } from './helpers/studio-harness.mjs';

const readFile = (name, value) => ({ name, text: () => Promise.resolve(value) });

test('startup does not replace a selection made while fonts are loading', async () => {
  const fonts = deferred();
  const fetched = [];
  const app = makeStudio({
    fonts: fonts.promise,
    fetcher: async (path) => {
      fetched.push(path);
      return { ok: true, text: async () => JSON.stringify(biology) };
    },
  });
  await app.node('exampleBiology').click();
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.ok(app.window.studioFrame().view.nodes.some((node) => node.id === 'kinase-k'));
  fonts.resolve();
  await app.ready;
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /biology/);
  assert.equal(app.node('exampleBiology').attributes['aria-pressed'], 'true');
});

test('every film font face is loaded before the first frame is drawn', async () => {
  const pending = deferred();
  const queries = [];
  const app = makeStudio({
    loadFont: (query) => {
      queries.push(query);
      return pending.promise;
    },
  });
  await flush();
  assert.deepEqual(queries, [
    '400 16px "Noto Sans CJK SC"',
    '500 16px "Noto Sans CJK SC"',
    '700 16px "Noto Sans CJK SC"',
    '600 16px "Noto Serif CJK SC"',
    '400 16px "Noto Sans Mono CJK SC"',
  ]);
  assert.deepEqual(app.themes, [], 'no renderer before the fonts load');
  pending.resolve([{}]);
  await app.ready;
  assert.equal(app.themes.length, 1);
  assert.equal(app.node('status').attributes['data-state'], 'ready');
});

test('a failed font load still opens the workspace with fallback fonts', async () => {
  const app = makeStudio({ loadFont: () => Promise.reject(new Error('offline')) });
  await app.ready;
  assert.equal(app.node('status').attributes['data-state'], 'ready');
});

test('latest local read wins, pauses playback, and stale failures do not replace the film', async () => {
  const app = makeStudio();
  await app.ready;
  await app.node('play').click();
  assert.equal(app.node('status').attributes['data-state'], 'playing');
  app.tick(1000);
  const older = deferred(),
    newer = deferred();
  const input = app.node('fileInput');
  input.files = [{ name: 'older.json', text: () => older.promise }];
  await input.dispatch('change');
  assert.equal(input.value, '');
  assert.equal(app.node('status').attributes['data-state'], 'loading');
  assert.equal(app.node('play').disabled, true);
  assert.equal(app.jobs.size, 0);
  await app.node('play').click();
  assert.equal(app.jobs.size, 0);
  input.files = [{ name: 'newer.json', text: () => newer.promise }];
  await input.dispatch('change');
  newer.resolve(JSON.stringify(biology));
  await flush();
  assert.equal(app.node('sourceName').textContent, 'newer.json');
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  older.reject(new Error('old failure'));
  await flush();
  assert.equal(app.node('sourceName').textContent, 'newer.json');
  assert.ok(app.window.studioFrame().view.nodes.some((node) => node.id === 'kinase-k'));
  assert.equal(app.node('errors').textContent, '');
});

test('latest example request wins even when older network requests fail late', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const app = makeStudio({
    fetcher: async () => {
      calls++;
      if (calls === 1) return { ok: true, text: async () => JSON.stringify(literature) };
      return calls === 2 ? first.promise : second.promise;
    },
  });
  await app.ready;
  const oldRequest = app.node('exampleBiology').click();
  const newRequest = app.node('exampleLiterature').click();
  second.resolve({ ok: true, text: async () => JSON.stringify(literature) });
  await newRequest;
  first.reject(new Error('late network failure'));
  await oldRequest;
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.equal(app.node('exampleLiterature').attributes['aria-pressed'], 'true');
  assert.equal(app.node('exampleBiology').attributes['aria-pressed'], 'false');
  assert.match(app.node('sourceName').textContent, /红楼梦/);
  assert.equal(app.node('errors').textContent, '');
});

test('file selection and drag-and-drop show errors, warnings, and recover to a valid film', async () => {
  const app = makeStudio();
  await app.ready;
  const input = app.node('fileInput');
  input.files = [readFile('broken.json', '{')];
  await input.dispatch('change');
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'error');
  assert.match(app.node('errors').textContent, /JSON|语法错误/);
  assert.equal(app.node('diagCount').attributes['data-level'], 'error');
  assert.equal(app.window.studioFrame(), null);
  assert.equal(app.window.renderAt(0), false);
  assert.equal(app.node('sceneDescription').textContent, '没有已加载的有效数据。');
  input.files = [readFile('invalid-schema.json', '{}')];
  await input.dispatch('change');
  await flush();
  assert.match(app.node('errors').textContent, /FORMAT/);
  assert.equal(app.node('status').attributes['data-state'], 'error');
  const doc = structuredClone(literature);
  doc.characters[0].bio.summary = 'a'.repeat(121);
  const drop = app.node('dropzone');
  await drop.dispatch('drop', {
    dataTransfer: { files: [readFile('valid.json', JSON.stringify(doc))] },
  });
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.equal(app.node('sourceName').textContent, 'valid.json');
  assert.equal(app.node('diagCount').attributes['data-level'], 'warning');
  assert.match(app.node('warnings').textContent, /BIO_LENGTH/);
  assert.equal(app.node('exampleLiterature').attributes['aria-pressed'], 'false');
  assert.equal(app.node('exampleBiology').attributes['aria-pressed'], 'false');
});

test('unreadable files and failed example responses show actionable diagnostics', async () => {
  let calls = 0;
  const app = makeStudio({
    fetcher: async () => {
      calls++;
      if (calls === 1) return { ok: true, text: async () => JSON.stringify(literature) };
      return { ok: false, status: 503 };
    },
  });
  await app.ready;
  const input = app.node('fileInput');
  input.files = [{ name: 'unreadable.json', text: () => Promise.reject(new Error('blocked')) }];
  await input.dispatch('change');
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'error');
  assert.match(app.node('errors').textContent, /FILE.*blocked/);
  await app.node('exampleBiology').click();
  assert.equal(app.node('status').attributes['data-state'], 'error');
  assert.match(app.node('errors').textContent, /LOAD.*HTTP 503/);
  assert.match(app.node('errors').textContent, /npm run preview/);
});

test('random access, frame controls, keyboard focus and theme changes preserve playback state', async () => {
  const app = makeStudio();
  await app.ready;
  const total = Number(app.node('scrubber').max);
  for (const frame of [0, 48, total, 10, 48, 0]) {
    assert.equal(app.window.renderAt(frame), true);
    assert.equal(Number(app.node('scrubber').value), frame);
    assert.match(app.node('scrubber').attributes['aria-valuetext'], /分镜/);
  }
  for (const frame of [-1, 0.5, total + 1, NaN]) assert.equal(app.window.renderAt(frame), false);
  const snapshot = app.window.studioFrame();
  snapshot.view.nodes[0].label = 'modified';
  assert.notEqual(app.window.studioFrame().view.nodes[0].label, 'modified');
  await app.node('play').click();
  app.tick(1000);
  app.tick(1010);
  await app.node('themeToggle').click();
  assert.equal(app.node('status').attributes['data-state'], 'playing');
  app.tick(1050);
  assert.equal(Number(app.node('scrubber').value), 1);
  const event = {
    code: 'ArrowRight',
    target: new (app.node('play').constructor)(),
    preventDefault() {},
  };
  event.target.focusSelector = 'button';
  app.window.dispatch('keydown', event);
  assert.equal(app.node('status').attributes['data-state'], 'playing');
  event.target.focusSelector = '';
  app.window.dispatch('keydown', event);
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.equal(Number(app.node('scrubber').value), 25);
  await app.node('restart').click();
  assert.equal(Number(app.node('scrubber').value), 0);
});

test('system theme follows until a choice is pinned even when storage throws', async () => {
  const storage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const app = makeStudio({ storage });
  await app.ready;
  assert.equal(app.themes.at(-1), 'dark');
  app.setOSTheme(true);
  assert.equal(app.themes.at(-1), 'light');
  await app.node('themeToggle').click();
  assert.equal(app.themes.at(-1), 'dark');
  assert.equal(app.document.documentElement.attributes['data-theme'], 'dark');
  app.setOSTheme(true);
  assert.equal(app.themes.at(-1), 'dark');
});

test('missing or incorrectly typed workspace elements fail with their ID', async () => {
  const missing = makeStudio({ missingId: 'stage' });
  await assert.rejects(missing.ready, /Missing or invalid workspace element: #stage/);
  const wrongType = makeStudio({ wrongId: 'fileInput' });
  await assert.rejects(wrongType.ready, /Missing or invalid workspace element: #fileInput/);
});

test('shot view keeps focus and future titles safe during seek', async () => {
  const app = makeStudio();
  await app.ready;
  const buttons = [...app.node('shots').children];
  assert.equal(buttons.length, literature.presentation.length);
  const futureTitle = literature.presentation.at(-1).title;
  assert.equal(app.node('shots').textContent.includes(futureTitle), false);
  for (const button of buttons.slice(1)) {
    assert.match(button.lastElementChild.textContent, /^分镜 [0-9]+$/);
    assert.match(button.attributes['aria-label'], /^跳转至分镜 [0-9]+$/);
    assert.equal(button.attributes.title, undefined, 'no future title in tooltips');
  }

  await buttons[1].click();
  assert.equal(app.document.activeElement, buttons[1]);
  assert.equal(buttons[1].attributes['aria-current'], 'step');
  assert.equal(buttons[0].attributes['aria-current'], undefined);
  assert.equal(buttons[0].lastElementChild.textContent, '分镜 1');
  assert.equal(app.node('shots').textContent.includes(futureTitle), false);
  const selectedFrame = Number(app.node('scrubber').value);
  assert.equal(app.window.renderAt(selectedFrame + 1), true);
  assert.equal(app.document.activeElement, buttons[1], 'repaint keeps keyboard focus');
  assert.equal(app.node('shots').children[1], buttons[1], 'render reuses buttons');
  assert.match(buttons[1].children[0].attributes.style, /^transform:scaleX\(/);

  const scrubber = app.node('scrubber');
  scrubber.value = '0';
  await scrubber.dispatch('input');
  assert.equal(buttons[0].attributes['aria-current'], 'step');
  assert.equal(buttons[1].attributes['aria-current'], undefined);
  assert.equal(buttons[1].children[0].attributes.style, 'transform:scaleX(0)');
  assert.equal(app.node('shots').children[0], buttons[0]);
});

test('playback view preserves accessible state through pause, end and replay', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.node('play').attributes['aria-label'], '播放');
  await app.node('play').click();
  assert.equal(app.node('play').attributes['aria-label'], '暂停');
  assert.equal(app.node('play').className, 'icon-button play is-playing');
  app.tick(1000);
  app.tick(101000);
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.equal(app.node('play').attributes['aria-label'], '播放');
  assert.equal(app.node('scrubber').value, app.node('scrubber').max);
  await app.node('play').click();
  assert.equal(app.node('scrubber').value, '0');
  assert.equal(app.node('play').attributes['aria-label'], '暂停');
  await app.node('play').click();
  assert.equal(app.node('status').attributes['data-state'], 'ready');
});

test('same-shot a11y reveals update transcript without repeat announcements', async () => {
  const app = makeStudio({
    // Simulate later within-shot a11y reveals using the actual shared VM/renderer path,
    // without a second DOM, timeline implementation, or unprojected graph text.
    transformFrameText(a11y, frame) {
      return {
        ...a11y,
        nodes: [
          ...a11y.nodes,
          ...(frame >= 2 ? [frame >= 5 ? 'VISIBLE SECOND RENAMED' : 'VISIBLE SECOND'] : []),
        ],
        relations: [...a11y.relations, ...(frame >= 4 ? ['REVEALED RELATION'] : [])],
      };
    },
  });
  await app.ready;
  const transcript = app.node('transcript');
  const live = app.node('sceneDescription');
  const first = transcript.children[0];
  const announcements = live.textWrites;
  assert.equal(transcript.textContent.includes('VISIBLE SECOND'), false);
  assert.equal(transcript.textContent.includes('REVEALED RELATION'), false);

  assert.equal(app.window.renderAt(1), true);
  assert.equal(transcript.children[0], first, 'unchanged semantics reuse transcript DOM');
  assert.equal(live.textWrites, announcements, 'animation frames do not repeat live announcements');

  assert.equal(app.window.renderAt(2), true);
  assert.match(transcript.textContent, /VISIBLE SECOND/);
  assert.equal(app.window.studioFrame().playback.index, 0, 'reveal stays in one shot');
  assert.equal(live.textWrites, announcements + 1, 'node count changes the live message');
  const nodeIntro = transcript.children[0];

  assert.equal(app.window.renderAt(3), true);
  assert.equal(transcript.children[0], nodeIntro);
  assert.equal(live.textWrites, announcements + 1);

  assert.equal(app.window.renderAt(4), true);
  assert.match(transcript.textContent, /REVEALED RELATION/);
  assert.equal(live.textWrites, announcements + 2);

  assert.equal(app.window.renderAt(5), true);
  assert.match(transcript.textContent, /VISIBLE SECOND RENAMED/);
  assert.equal(
    live.textWrites,
    announcements + 2,
    'same-count label change updates transcript, not duplicate live status',
  );
  const renamedIntro = transcript.children[0];
  assert.equal(app.window.renderAt(5), true);
  assert.equal(transcript.children[0], renamedIntro);
  assert.equal(live.textWrites, announcements + 2);

  assert.equal(app.window.renderAt(0), true);
  assert.doesNotMatch(transcript.textContent, /VISIBLE SECOND|REVEALED RELATION/);
  assert.doesNotMatch(live.textContent, /VISIBLE SECOND|REVEALED RELATION/);
  assert.equal(live.textWrites, announcements + 3, 'rewind withdraws exposed content');
});

test('document switches reset cached text, and errors clear the transcript', async () => {
  const app = makeStudio();
  await app.ready;
  assert.match(app.node('currentShot').textContent, /大观园/);
  const input = app.node('fileInput');
  input.files = [readFile('other.json', JSON.stringify(biology))];
  await input.dispatch('change');
  await flush();
  assert.equal(app.node('sourceName').textContent, 'other.json');
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.doesNotMatch(app.node('transcript').textContent, /大观园/);
  assert.equal(app.node('diagCount').hidden, true);
  assert.equal(
    app.node('nodeCount').textContent,
    String(app.window.studioFrame().view.nodes.length),
  );
  input.files = [readFile('invalid.json', '{')];
  await input.dispatch('change');
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'error');
  assert.equal(app.node('transcript').textContent, '');
  assert.equal(app.node('sceneDescription').textContent, '没有已加载的有效数据。');
  assert.match(app.node('errors').textContent, /JSON|语法错误/);
});

test('pending and stale loads cannot expose outdated diagnostics', async () => {
  const app = makeStudio();
  await app.ready;
  const input = app.node('fileInput');
  input.files = [readFile('broken.json', '{')];
  await input.dispatch('change');
  await flush();
  assert.match(app.node('errors').textContent, /JSON|语法错误/);

  const old = deferred();
  const current = deferred();
  input.files = [{ name: 'old.json', text: () => old.promise }];
  await input.dispatch('change');
  assert.equal(app.node('errors').textContent, '');
  assert.equal(app.node('warnings').textContent, '');
  assert.equal(app.node('diagCount').hidden, true);

  input.files = [{ name: 'current.json', text: () => current.promise }];
  await input.dispatch('change');
  old.reject(new Error('late stale failure'));
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'loading');
  assert.equal(app.node('errors').textContent, '');

  // The literary fixture intentionally warns about three importance-5 leads.
  // Use the warning-free biology fixture to exercise the empty state.
  current.resolve(JSON.stringify(biology));
  await flush();
  assert.equal(app.node('sourceName').textContent, 'current.json');
  assert.equal(app.node('status').attributes['data-state'], 'ready');
  assert.equal(app.node('diagCount').hidden, true);
  assert.equal(app.node('errors').textContent, '');
  assert.equal(app.node('warnings').textContent, '未发现校验问题。');
});

function viewControl(app, id) {
  const stack = [app.node('appearanceEditor'), app.node('layoutStrategyEditor')];
  while (stack.length) {
    const element = stack.pop();
    if (element.id === id) return element;
    stack.push(...(element.children ?? []));
  }
  throw new Error('Missing generated view control: ' + id);
}

test('project savepoint follows edits, full exports, undo/redo and beforeunload', async () => {
  const app = makeStudio();
  await app.ready;
  const status = app.node('saveState');
  assert.equal(status.attributes['data-dirty'], 'false');
  let prevented = false;
  app.window.dispatch('beforeunload', {
    preventDefault() {
      prevented = true;
    },
    returnValue: 'unchanged',
  });
  assert.equal(prevented, false, 'clean startup is free to leave');

  const preset = viewControl(app, 'visualPreset');
  preset.value = 'presentation';
  await preset.dispatch('change');
  assert.equal(status.attributes['data-dirty'], 'true');
  assert.match(status.textContent, /未保存/);
  assert.match(app.document.title, /^● /);
  const exit = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    returnValue: 'unchanged',
  };
  app.window.dispatch('beforeunload', exit);
  assert.equal(exit.prevented, true);
  assert.equal(exit.returnValue, '');

  await app.node('layoutExport').click();
  assert.equal(status.attributes['data-dirty'], 'true', 'source-only export is not project save');
  assert.match(app.downloads.at(-1).filename, /\.positioned\.json$/);

  await viewControl(app, 'visualSave').click();
  assert.match(app.downloads.at(-1).filename, /\.studio\.json$/);
  assert.equal(status.attributes['data-dirty'], 'false', 'full export establishes a savepoint');
  assert.match(viewControl(app, 'visualError').textContent, /请确认/);
  app.window.dispatch('beforeunload', {
    preventDefault() {
      prevented = true;
    },
    returnValue: 'unchanged',
  });
  assert.equal(status.attributes['data-dirty'], 'false');

  await viewControl(app, 'visualUndo').click();
  assert.equal(status.attributes['data-dirty'], 'true', 'undo past export is an unsaved state');
  await viewControl(app, 'visualRedo').click();
  assert.equal(status.attributes['data-dirty'], 'false', 'redo back to export is clean');
});

test('cancelled source replacements preserve the edited document and history', async () => {
  const app = makeStudio();
  await app.ready;
  const sourceName = app.node('sourceName').textContent;
  const preset = viewControl(app, 'visualPreset');
  preset.value = 'quiet';
  await preset.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  let confirmations = 0;
  app.window.confirm = () => {
    confirmations++;
    return false;
  };
  await app.node('exampleBiology').click();
  assert.equal(app.node('sourceName').textContent, sourceName);
  assert.equal(app.node('exampleLiterature').attributes['aria-pressed'], 'true');

  const input = app.node('fileInput');
  input.files = [readFile('replacement.json', JSON.stringify(biology))];
  await input.dispatch('change');
  await flush();
  assert.equal(input.value, '', 'reselecting the same file remains possible');
  assert.equal(app.node('sourceName').textContent, sourceName);

  await app.node('dropzone').dispatch('drop', {
    dataTransfer: { files: [readFile('dropped.json', JSON.stringify(biology))] },
  });
  await flush();
  assert.equal(confirmations, 3);
  assert.equal(app.node('sourceName').textContent, sourceName);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  assert.equal(viewControl(app, 'visualUndo').disabled, false);

  app.window.confirm = () => true;
  await app.node('exampleBiology').click();
  assert.match(app.node('sourceName').textContent, /生物信号/);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  assert.equal(viewControl(app, 'visualUndo').disabled, true);
});

test('unsent copy drafts are protected and cannot be mistaken for a saved project', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  assert.ok(objects.children.length > 1);
  objects.value = objects.children[1].value;
  await objects.dispatch('change');
  const label = viewControl(app, 'visualLabel');
  label.value += ' · 草稿';
  await label.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  const count = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count);
  assert.match(viewControl(app, 'visualError').textContent, /未提交/);
  await label.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count + 1);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});

test('layout previews and uncommitted strategy drafts are guarded separately', async () => {
  const app = makeStudio();
  await app.ready;
  const type = viewControl(app, 'strategyType');
  const mode = viewControl(app, 'strategyMode');
  type.value = 'circle';
  mode.value = 'rearrange';
  await type.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true', 'draft before preview');
  await viewControl(app, 'strategyPreview').click();
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  await viewControl(app, 'strategyCancel').click();
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true', 'cancel keeps input drafts');
  type.value = 'manual';
  await type.dispatch('change');
  mode.value = 'preserve';
  await mode.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});
