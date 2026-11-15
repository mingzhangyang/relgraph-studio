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

test('W4: the disclosure summary holds the layout panel’s one heading', async () => {
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
  // One semantic heading, inside the summary (#46 review, P3): the panel
  // keeps a place in the heading outline, open or closed.
  assert.match(
    disclosure,
    /<summary><h2 class="summary-heading">布局策略 · 预览后应用<\/h2><\/summary>/,
  );
  assert.equal(disclosure.match(/<h[1-6]/g).length, 1);
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

/**
 * Every text the layout panel shows, option labels included; node names in
 * the lock menu are source data and are never translated.
 */
function panelTexts(app) {
  const texts = [],
    visit = (element) => {
      if (element.hidden || element.id === 'strategyNode') return;
      if (element.children?.length) element.children.forEach(visit);
      else if (element.textContent) texts.push(element.textContent);
    };
  visit(app.node('layoutStrategyEditor'));
  return texts;
}

test('W3: the panel shows which strategies suit the graph before anything is applied', async () => {
  const app = makeStudio();
  await app.ready;
  await openExample(app, 'exampleTimeline');
  const fit = control(app, 'strategyFit'),
    option = (value) =>
      control(app, 'strategyType').children.find((child) => child.value === value).textContent;
  // Dated, without relations: the timeline suits, a tree does not.
  assert.equal(option('timeline'), '时间轴 · 按时间排开');
  assert.equal(option('tree'), '树 · 向右展开（不适合此图）');
  assert.equal(option('grid'), '网格 · 保持顺序');
  assert.equal(fit.textContent, '保留当前画面，不移动任何节点。');
  await choose(app, 'strategyType', 'timeline');
  assert.equal(fit.textContent, '适合：节点带有日期，按时间排开。');
  assert.equal(fit.attributes['data-suits'], 'true');
  await choose(app, 'strategyType', 'layered');
  assert.equal(fit.textContent, '不适合：图中没有关系，节点会排成紧凑的一组。');
  assert.equal(fit.attributes['data-suits'], 'false');

  // The bookshop has no dates: the timeline says it will draw a tree.
  await openExample(app, 'exampleGraph');
  assert.equal(option('timeline'), '时间轴 · 按时间排开（不适合此图）');
  await choose(app, 'strategyType', 'timeline');
  assert.equal(fit.textContent, '不适合：没有节点带日期，将改画为树。');
  await choose(app, 'strategyType', 'auto');
  assert.equal(fit.textContent, '将使用：流向 · 从左到右（按图的结构）');

  // Every panel text has its English, menus included. As in the
  // production-build test, the panel joins the body so the static
  // translation pass reaches its labels and buttons.
  app.document.body.append(app.node('layoutStrategyEditor'));
  const language = app.node('languageSelect');
  language.value = 'en';
  await language.dispatch('change');
  assert.equal(fit.textContent, 'Will use: Flow · Left to right (chosen from the graph structure)');
  assert.equal(option('timeline'), 'Timeline · Placed in time (does not suit this graph)');
  for (const type of ['manual', 'force', 'layered', 'tree', 'timeline', 'grid']) {
    await choose(app, 'strategyType', type);
    const chinese = panelTexts(app).filter((text) => /[\u3400-\u9fff]/.test(text));
    assert.deepEqual(chinese, [], `English panel under ${type}`);
  }
});

const example = (file) =>
  JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));
async function openFile(app, name, value) {
  const input = app.node('fileInput');
  input.files = [{ name, text: () => Promise.resolve(JSON.stringify(value)) }];
  await input.dispatch('change');
  await flush();
  assert.equal(app.node('status').attributes['data-state'], 'ready');
}

test('#46 review, P2: a project that stores a type without its coordinates is not "applied"', async () => {
  const app = makeStudio();
  await app.ready;
  await openFile(app, 'bookshop.studio.json', {
    format: 'relgraph.studio/1',
    source: example('bookshop-systems-synthetic.graph.json'),
    config: {
      layout: {
        type: 'grid',
        mode: 'rearrange',
        seed: 0,
        spacing: 150,
        iterations: 300,
        locked: [],
        positions: {},
      },
    },
  });
  const drawn = () => control(app, 'strategyDrawn').textContent,
    automatic = '当前画面：载入时自动排布：流向 · 从左到右（按图的结构）';
  assert.equal(control(app, 'strategyType').value, 'grid');
  assert.equal(drawn(), automatic, 'grid never drew this picture');
  // A hand edit stores one coordinate: still the automatic picture, adjusted.
  assert.equal(app.window.renderAt(84), true);
  await app.node('layoutToggle').click();
  const x = app.node('layoutX');
  x.value = String(Number(x.value) + 40);
  await x.dispatch('input');
  await app.node('layoutApply').click();
  assert.equal(drawn(), automatic + '，并有手动微调');
  await app.node('layoutToggle').click();
  // Applying grid writes every coordinate: now grid drew it.
  await control(app, 'strategyPreview').click();
  await control(app, 'strategyApply').click();
  assert.equal(drawn(), '当前画面：已应用：网格 · 保持顺序');
});

test('#46 review, P2: dates all at one time are worded as such, not as "no dates"', async () => {
  const app = makeStudio();
  await app.ready;
  const source = example('dynasties-timeline-provisional.graph.json');
  for (const node of source.nodes) {
    node.start = 2020;
    delete node.end;
  }
  await openFile(app, 'same-year.graph.json', source);
  await choose(app, 'strategyType', 'timeline');
  const fit = control(app, 'strategyFit');
  assert.equal(fit.textContent, '不适合：所有日期都在同一时间，没有可排开的时间范围，将改画为树。');
  assert.doesNotMatch(fit.textContent, /没有节点带日期/);
  assert.equal(
    control(app, 'strategyDrawn').textContent,
    '当前画面：载入时自动排布：树 · 向右展开（所有日期都在同一时间，没有时间范围，时间轴退回为树）',
  );
  const language = app.node('languageSelect');
  language.value = 'en';
  await language.dispatch('change');
  assert.equal(
    fit.textContent,
    'Does not suit this graph: every date is at the same time, so there is no range to place nodes along and it is drawn as a tree.',
  );
});
