// The layout panel of the workspace (PR 6, W1–W4), in the shared simulated DOM.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flush, makeStudio } from './helpers/studio-harness.mjs';

/** Every element below `root`, depth first. */
function descendants(root) {
  const found = [],
    stack = [...(root.children ?? [])];
  while (stack.length) {
    const element = stack.shift();
    found.push(element);
    stack.unshift(...(element.children ?? []));
  }
  return found;
}

test('W4: the disclosure summary is the layout panel’s one heading', async () => {
  const app = makeStudio();
  await app.ready;
  const panel = app.node('layoutStrategyEditor');
  assert.deepEqual(
    descendants(panel)
      .map((element) => element.tagName)
      .filter((tag) => /^H[1-6]$/.test(tag)),
    [],
    'the panel adds no heading below the disclosure',
  );
  const html = readFileSync(new URL('../demo/index.html', import.meta.url), 'utf8');
  const disclosure = /<details id="layoutStrategies"[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1];
  assert.ok(disclosure);
  assert.match(disclosure, /<summary>布局策略 · 预览后应用<\/summary>/);
  assert.doesNotMatch(disclosure, /<h[1-6]/);
});

/** A control of the layout panel by id. */
function control(app, id) {
  const found = descendants(app.node('layoutStrategyEditor')).find((element) => element.id === id);
  assert.ok(found, id);
  return found;
}
async function choose(app, id, value) {
  const select = control(app, id);
  select.value = value;
  await select.dispatch('change');
}
async function openExample(app, id) {
  await app.node(id).click();
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'ready');
}
/** The settings whose labels are shown, in panel order. */
const shownSettings = (app) =>
  ['strategyMode', 'strategySeed', 'strategySpacing', 'strategyIterations'].filter(
    (id) => !control(app, id).parentElement.hidden,
  );

test('W1: the panel shows the settings the chosen strategy reads for this graph', async () => {
  const app = makeStudio();
  await app.ready;
  await openExample(app, 'exampleGraph');
  const expected = {
    manual: [],
    force: ['strategyMode', 'strategySeed', 'strategySpacing', 'strategyIterations'],
    radial: ['strategyMode', 'strategySeed', 'strategySpacing'],
    circle: ['strategyMode', 'strategySeed', 'strategySpacing'],
    layered: ['strategyMode', 'strategySpacing'],
    flow: ['strategyMode', 'strategySpacing'],
    tree: ['strategyMode', 'strategySpacing'],
    mindmap: ['strategyMode', 'strategySpacing'],
    // Undated: drawn as a tree.
    timeline: ['strategyMode', 'strategySpacing'],
    grid: ['strategyMode', 'strategySpacing'],
  };
  for (const [type, shown] of Object.entries(expected)) {
    await choose(app, 'strategyType', type);
    assert.deepEqual(shownSettings(app), shown, type);
  }
  // Auto shows what the engine it chooses reads: flow for the bookshop's
  // directed, acyclic relations, force for the novel, a tree by its kind.
  await choose(app, 'strategyType', 'auto');
  assert.deepEqual(shownSettings(app), expected.flow);
  await openExample(app, 'exampleLiterature');
  await choose(app, 'strategyType', 'auto');
  assert.deepEqual(shownSettings(app), expected.force);
  await openExample(app, 'exampleTree');
  assert.equal(control(app, 'strategyType').value, 'manual', 'a new document resets the panel');
  assert.deepEqual(shownSettings(app), []);
  await choose(app, 'strategyType', 'auto');
  assert.deepEqual(shownSettings(app), ['strategyMode', 'strategySpacing']);
});

test('W1: a hidden setting is neither validated, previewed nor counted as a draft', async () => {
  const app = makeStudio();
  await app.ready;
  await openExample(app, 'exampleGraph');
  const iterations = control(app, 'strategyIterations'),
    note = control(app, 'strategyNote');
  await choose(app, 'strategyType', 'grid');
  await choose(app, 'strategyMode', 'rearrange');
  // Left empty while hidden: the preview runs with the stored value.
  iterations.value = '';
  await iterations.dispatch('input');
  await control(app, 'strategyPreview').click();
  assert.doesNotMatch(note.textContent, /参数不能为空/);
  assert.equal(control(app, 'strategyApply').disabled, false, 'a grid preview is pending');
  await control(app, 'strategyCancel').click();
  // Back on manual, nothing the strategy reads differs from the stored settings.
  await choose(app, 'strategyType', 'manual');
  assert.equal(app.node('saveState').attributes['data-dirty'], 'false');
  // Shown again, the same empty input is refused.
  await choose(app, 'strategyType', 'force');
  await control(app, 'strategyPreview').click();
  assert.equal(note.textContent, '参数不能为空。');
});

test('W2: the panel says what drew the picture, through edits, Apply, undo and Reset', async () => {
  const app = makeStudio();
  await app.ready;
  const drawn = () => control(app, 'strategyDrawn');
  // The novel stores its coordinates.
  assert.equal(drawn().textContent, '当前画面：文档保存的坐标');
  await openExample(app, 'exampleGraph');
  const automatic = '当前画面：载入时自动排布：流向 · 从左到右（按图的结构）';
  assert.equal(drawn().textContent, automatic);
  assert.equal(drawn().hidden, false);
  // The strategy that keeps the picture is not named as if it drew it.
  assert.equal(control(app, 'strategyType').value, 'manual');
  assert.doesNotMatch(drawn().textContent, /保留当前画面/);

  const language = app.node('languageSelect');
  language.value = 'en';
  await language.dispatch('change');
  assert.equal(
    drawn().textContent,
    'Current picture: Arranged on load: Flow · Left to right (chosen from the graph structure)',
  );
  language.value = 'zh-CN';
  await language.dispatch('change');

  // Moving a node by hand is said; Reset takes it back.
  assert.equal(app.window.renderAt(84), true);
  await app.node('layoutToggle').click();
  const x = app.node('layoutX');
  x.value = String(Number(x.value) + 40);
  await x.dispatch('input');
  await app.node('layoutApply').click();
  assert.equal(drawn().textContent, automatic + '，并有手动微调');
  await app.node('layoutReset').click();
  assert.equal(drawn().textContent, automatic);
  await app.node('layoutToggle').click();

  // A preview does not change the line; Apply does, and undo restores it.
  await choose(app, 'strategyType', 'grid');
  await choose(app, 'strategyMode', 'rearrange');
  await control(app, 'strategyPreview').click();
  assert.equal(control(app, 'strategyApply').disabled, false);
  assert.equal(drawn().textContent, automatic);
  await control(app, 'strategyApply').click();
  assert.equal(drawn().textContent, '当前画面：已应用：网格 · 保持顺序');
  await app.node('visualUndo').click();
  assert.equal(drawn().textContent, automatic);
  await app.node('visualRedo').click();
  assert.equal(drawn().textContent, '当前画面：已应用：网格 · 保持顺序');
});
