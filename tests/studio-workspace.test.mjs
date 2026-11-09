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

test('selection changes reconcile controls before updating the unsaved indicator', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  const choices = objects.children.filter((option) => option.value).map((option) => option.value);
  assert.ok(choices.length >= 2, 'the test needs two visible nodes');
  const labels = [];
  for (const id of choices.slice(0, 2)) {
    objects.value = id;
    await objects.dispatch('change');
    labels.push(viewControl(app, 'visualLabel').value);
    assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
    assert.doesNotMatch(app.document.title, /^● /);
  }
  assert.notEqual(labels[0], labels[1], 'selection should change the displayed label');
  objects.value = '';
  await objects.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});

test('pending numeric appearance drafts work in the shared source-VM harness', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  objects.value = objects.children[1].value;
  await objects.dispatch('change');
  const size = viewControl(app, 'visual-size');
  assert.equal(size.disabled, false);
  const original = size.value;
  size.value = original === '999' ? '998' : '999';
  await size.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  const count = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count, 'uncommitted number cannot be exported as saved');
  size.value = original;
  await size.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});

test('clearing an override inherits a value without an unsaved draft', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  objects.value = objects.children[1].value;
  await objects.dispatch('change');

  const scope = viewControl(app, 'visualScope');
  scope.value = 'object';
  await scope.dispatch('change');
  const preset = viewControl(app, 'visualPreset');
  preset.value = 'presentation';
  await preset.dispatch('change');
  const font = viewControl(app, 'visual-fontSize');
  assert.equal(font.value, '18', 'presentation preset provides the inherited font size');

  font.value = '22';
  await font.dispatch('input');
  await font.dispatch('change');
  assert.equal(font.value, '22', 'object override was committed');

  font.value = '';
  await font.dispatch('input');
  await font.dispatch('change');
  assert.equal(font.value, '18', 'successful removal displays inherited value');
  assert.equal(viewControl(app, 'visualError').textContent, '');
  assert.equal(
    app.node('saveState').attributes['data-dirty'],
    'true',
    'prior preset still differs',
  );

  const count = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count + 1, 'accepted inherited value must not block export');
  const exported = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(exported.config.nodes?.objects?.[objects.value]?.fontSize, undefined);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});

test('rejected property changes survive blur, redraw and selection changes until corrected', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  const visible = objects.children.filter((o) => o.value).map((o) => o.value);
  assert.ok(visible.length >= 2);
  objects.value = visible[0];
  await objects.dispatch('change');
  const size = viewControl(app, 'visual-size');
  const original = size.value;
  size.value = '999';
  size.focus();
  await size.dispatch('input');
  await size.dispatch('change');
  assert.match(viewControl(app, 'visualError').textContent, /配置无效/);
  size.blur();

  assert.equal(app.window.renderAt(85), true);
  assert.equal(size.value, '999', 'rejected size draft must survive redraw');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  let confirmations = 0;
  app.window.confirm = () => {
    ++confirmations;
    return false;
  };
  const originalSource = app.node('sourceName').textContent;
  await app.node('exampleBiology').click();
  assert.equal(confirmations, 1);
  assert.equal(app.node('sourceName').textContent, originalSource);
  const downloads = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, downloads, 'rejected draft blocks full export');

  objects.value = visible[1];
  await objects.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true', 'hidden draft persists');
  objects.value = visible[0];
  await objects.dispatch('change');
  assert.equal(size.value, '999', 'returning to object restores rejected value');

  size.value = original;
  await size.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, downloads + 1);
});

test('restoring original copy explicitly discards uncommitted text drafts', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  objects.value = objects.children[1].value;
  await objects.dispatch('change');
  const label = viewControl(app, 'visualLabel');
  const original = label.value;
  label.value += ' · 不提交的文字';
  await label.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  await viewControl(app, 'visualRestoreText').click();
  assert.equal(label.value, original);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});

test('manual X/Y drafts persist per node, including when position mode is closed', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  await app.node('layoutToggle').click();
  const chooser = app.node('layoutNode');
  const ids = chooser.children.map((option) => option.value);
  assert.ok(ids.length >= 2, 'two visible editable nodes are required');
  const x = app.node('layoutX');
  const y = app.node('layoutY');

  chooser.value = ids[0];
  await chooser.dispatch('change');
  const originalAX = x.value;
  const draftAX = String(Number(originalAX) + 19);
  x.value = draftAX;
  await x.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  chooser.value = ids[1];
  await chooser.dispatch('change');
  const originalBY = y.value;
  const draftBY = String(Number(originalBY) + 11);
  y.value = draftBY;
  await y.dispatch('input');

  chooser.value = ids[0];
  await chooser.dispatch('change');
  assert.equal(x.value, draftAX, 'node A draft survives switching to B');
  await app.node('layoutToggle').click();
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true', 'hidden drafts stay dirty');
  await app.node('layoutToggle').click();
  assert.equal(x.value, draftAX, 'node A draft survives hiding the editor');

  const before = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, before, 'drafts on either node block export');

  await app.node('layoutApply').click();
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  chooser.value = ids[1];
  await chooser.dispatch('change');
  assert.equal(y.value, draftBY, 'node B draft survives applying A');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, before, 'unapplied draft on B still blocks export');
  await app.node('layoutApply').click();
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, before + 1);
  const exported = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(exported.config.layout.positions[ids[0]].x, Number(draftAX));
  assert.equal(exported.config.layout.positions[ids[1]].y, Number(draftBY));
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
});

test('unapplied coordinates survive switching nodes until explicitly reset', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  await app.node('layoutToggle').click();
  const chooser = app.node('layoutNode');
  const ids = chooser.children.map((option) => option.value);
  assert.ok(ids.length >= 2);
  const x = app.node('layoutX');
  chooser.value = ids[0];
  await chooser.dispatch('change');
  const original = x.value;
  x.value = String(Number(original) + 9);
  await x.dispatch('input');
  chooser.value = ids[1];
  await chooser.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  const originalSource = app.node('sourceName').textContent;
  let prompts = 0;
  app.window.confirm = () => {
    ++prompts;
    return false;
  };
  await app.node('exampleBiology').click();
  assert.equal(prompts, 1);
  assert.equal(app.node('sourceName').textContent, originalSource);
  await app.node('layoutReset').click();
  chooser.value = ids[0];
  await chooser.dispatch('change');
  assert.equal(x.value, original, 'explicit reset discards the earlier coordinate draft');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  assert.equal(viewControl(app, 'visualUndo').disabled, true, 'draft-only reset adds no history');
});

test('incomplete native numbers remain drafts even when the browser reports an empty value', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  objects.value = objects.children[1].value;
  await objects.dispatch('change');
  const size = viewControl(app, 'visual-size');
  assert.equal(size.value, '', 'no size override is initially authored');

  // Native type=number exposes value === '' for an incomplete '-' token.
  size.validity = { badInput: true };
  size.value = '';
  await size.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  assert.equal(size.attributes['aria-invalid'], 'true');
  const before = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, before);

  // Some browsers sanitize validity on blur before change is dispatched.
  // The earlier badInput observation must still prevent committing 'inherit'.
  size.validity.badInput = false;
  await size.dispatch('change');
  assert.match(viewControl(app, 'visualError').textContent, /数字输入/);
  assert.equal(app.window.renderAt(85), true);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  let prompts = 0;
  app.window.confirm = () => {
    ++prompts;
    return false;
  };
  await app.node('exampleBiology').click();
  assert.equal(prompts, 1);
  const exit = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  app.window.dispatch('beforeunload', exit);
  assert.equal(exit.prevented, true);

  // A new, valid user input clears the invalid marker. Empty is a deliberate
  // inherit only after a fresh valid input event, not a blur sanitization.
  size.value = '24';
  await size.dispatch('input');
  assert.equal(size.attributes['aria-invalid'], 'false');
  await size.dispatch('change');
  size.value = '';
  await size.dispatch('input');
  await size.dispatch('change');
  // The editor may retain an empty scope container in history; that is not
  // an invalid draft and must not block an explicit complete-project save.
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, before + 1);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  const exported = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(exported.config.nodes?.objects?.[objects.value]?.size, undefined);
});

test('invalid number tokens cannot remove an existing saved override', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  objects.value = objects.children[1].value;
  await objects.dispatch('change');
  const size = viewControl(app, 'visual-size');
  size.value = '24';
  await size.dispatch('input');
  await size.dispatch('change');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');

  size.validity = { badInput: true };
  size.value = '';
  await size.dispatch('input');
  size.validity.badInput = false;
  await size.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  assert.equal(size.attributes['aria-invalid'], 'true');
  const count = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count);
  size.value = '24';
  await size.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  await size.dispatch('change');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count + 1);
  const exported = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(exported.config.nodes.objects[objects.value].size, 24);
});

test('cancelled drags must preserve coordinate drafts matching transient positions', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  await app.node('layoutToggle').click();

  const chooser = app.node('layoutNode');
  const stage = app.node('stage');
  const frame = app.window.studioFrame();
  let candidate = null;
  for (const option of chooser.children) {
    const id = option.value;
    chooser.value = id;
    await chooser.dispatch('change');
    const x = Number(app.node('layoutX').value);
    const y = Number(app.node('layoutY').value);
    const camera = frame.cameraResolved;
    const screen = {
      x: 640 + (x - camera.x) * camera.scale,
      y: 330 + (y - camera.y) * camera.scale,
    };
    if (screen.x < 26 || screen.x > 1254 || screen.y < 108 || screen.y > 542) continue;
    await stage.dispatch('pointerdown', {
      pointerId: 11,
      isPrimary: true,
      pointerType: 'mouse',
      button: 0,
      clientX: screen.x,
      clientY: screen.y,
    });
    if (stage.pointerCaptured === 11 && chooser.value === id) {
      candidate = { id, x, y, screen, camera };
      break;
    }
    if (stage.pointerCaptured === 11)
      await stage.dispatch('pointercancel', { pointerId: 11 });
  }
  assert.ok(candidate, 'the shared DOM hit test should find a movable visible node');
  // Release the probe drag. The draft must exist BEFORE the real drag begins.
  await stage.dispatch('pointercancel', { pointerId: 11 });
  const { id, x, screen, camera } = candidate;
  const draftX = x + 10;
  const xInput = app.node('layoutX');
  xInput.value = String(draftX);
  await xInput.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  await stage.dispatch('pointerdown', {
    pointerId: 12,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    clientX: screen.x,
    clientY: screen.y,
  });
  assert.equal(stage.pointerCaptured, 12);
  await stage.dispatch('pointermove', {
    pointerId: 12,
    clientX: screen.x + 10 * camera.scale,
    clientY: screen.y,
  });
  assert.equal(xInput.value, String(draftX), 'temporary drag reaches the typed coordinate');
  await stage.dispatch('pointercancel', { pointerId: 12 });
  assert.equal(xInput.value, String(draftX), 'cancelled drag restores the pending input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  const count = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count);
  const select = app.node('layoutNode');
  assert.equal(select.value, id);
  await app.node('layoutApply').click();
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, count + 1);
  const data = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(data.config.layout.positions[id].x, draftX);
});

test('unapplied manual coordinates block export and warn on source replacement', async () => {
  const app = makeStudio();
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  await app.node('layoutToggle').click();
  const x = app.node('layoutX');
  const y = app.node('layoutY');
  assert.equal(x.disabled, false);
  assert.equal(y.disabled, false);
  const originalX = x.value;
  const originalY = y.value;
  x.value = String(Number(originalX) + 13);
  await x.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  const exit = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  app.window.dispatch('beforeunload', exit);
  assert.equal(exit.prevented, true);

  let confirmations = 0;
  app.window.confirm = () => {
    confirmations++;
    return false;
  };
  const originalSource = app.node('sourceName').textContent;
  await app.node('exampleBiology').click();
  assert.equal(confirmations, 1);
  assert.equal(app.node('sourceName').textContent, originalSource);
  const downloads = app.downloads.length;
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, downloads);
  assert.match(viewControl(app, 'visualError').textContent, /未提交/);

  x.value = originalX;
  await x.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  y.value = '';
  await y.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, downloads, 'invalid coordinate draft cannot be saved');
  y.value = originalY;
  await y.dispatch('input');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');

  x.value = String(Number(originalX) + 13);
  await x.dispatch('input');
  await app.node('layoutApply').click();
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  await viewControl(app, 'visualSave').click();
  assert.equal(app.downloads.length, downloads + 1);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
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

test('pending image normalization is dirty, while confirmed replacement rejects its stale completion', async () => {
  const image = deferred();
  const app = makeStudio({ normalizeImage: () => image.promise });
  await app.ready;
  assert.equal(app.window.renderAt(84), true);
  const objects = viewControl(app, 'visualObject');
  assert.ok(objects.children.length > 1);
  objects.value = objects.children[1].value;
  await objects.dispatch('change');

  const picker = viewControl(app, 'visualImageFile');
  picker.files = [{ name: 'pending.png', type: 'image/png' }];
  await picker.dispatch('change');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');

  let confirmed = false;
  app.window.confirm = () => {
    confirmed = true;
    return false;
  };
  await app.node('exampleBiology').click();
  assert.equal(confirmed, true);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'true');
  assert.match(app.node('sourceName').textContent, /红楼梦/);

  app.window.confirm = () => true;
  await app.node('exampleBiology').click();
  image.resolve({
    id: 'late-image',
    asset: { format: 'rgba8', width: 1, height: 1, data: '/wAA/w==' },
  });
  await flush();
  assert.match(app.node('sourceName').textContent, /生物信号/);
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  assert.equal(viewControl(app, 'visualUndo').disabled, true);
});
