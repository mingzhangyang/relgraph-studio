import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createWorkspaceShellView } from '../apps/studio/src/workspace-shell-view.ts';
import { createSimulatedStudioDom } from './helpers/studio-dom.mjs';

function makeView(options = {}) {
  const dom = createSimulatedStudioDom(options);
  const id = (key) => dom.document.getElementById(key);
  const view = createWorkspaceShellView(dom.document, {
    canvas: id('stage'),
    domainTime: id('domainTime'),
    sceneCount: id('sceneCount'),
    sourceName: id('sourceName'),
    sourceNote: id('sourceNote'),
    exampleLiterature: id('exampleLiterature'),
    exampleBiology: id('exampleBiology'),
    themeToggle: id('themeToggle'),
    dropzone: id('dropzone'),
  });
  return { dom, id, view };
}

test('shell projection label is stable and resets without leaking previous metadata', () => {
  const { id, view } = makeView();
  view.renderSourceName('source.json');
  view.renderSourceSummary(2, '', 'public description');
  view.renderDomainTime(0, 'year');
  assert.equal(id('sourceNote').textContent, 'public description');
  assert.equal(id('domainTime').textContent, '领域时间：year 0');
  const writes = id('domainTime').textWrites;
  view.renderDomainTime(0, 'year');
  assert.equal(id('domainTime').textWrites, writes, 'avoid repeated announcements');
  view.renderDomainTime(null, undefined);
  assert.equal(id('domainTime').textContent, '领域时间：未指定');
  view.resetMetadata();
  assert.equal(id('domainTime').textContent, '领域时间：—');
  assert.equal(id('sceneCount').textContent, '0');
  assert.equal(id('sourceName').textContent, 'source.json', 'source name set by next load');
});

test('shell keeps source pressed states, theme affordance and dropzone presentation', () => {
  const { dom, id, view } = makeView();
  view.markSource('exampleBiology');
  assert.equal(id('exampleLiterature').attributes['aria-pressed'], 'false');
  assert.equal(id('exampleBiology').attributes['aria-pressed'], 'true');
  view.markSource(null);
  assert.equal(id('exampleBiology').attributes['aria-pressed'], 'false');
  view.renderTheme('light', true);
  assert.equal(dom.document.documentElement.attributes['data-theme'], 'light');
  assert.equal(id('themeToggle').attributes['aria-label'], '切换到深色模式');
  view.renderTheme('dark', false);
  assert.equal(dom.document.documentElement.attributes['data-theme'], 'light');
  assert.equal(id('themeToggle').attributes['aria-label'], '切换到浅色模式');
  view.renderDropzoneDragging(true);
  assert.equal(id('dropzone').className, 'dropzone dragging');
  view.renderDropzoneDragging(false);
  assert.equal(id('dropzone').className, 'dropzone');
});

for (const theme of ['dark', 'light']) {
  test(`empty Canvas paints ${theme} and retains the latest message across theme repaints`, () => {
    const calls = [];
    const context = {
      fillRect(...bounds) {
        calls.push({ method: 'fillRect', bounds, fillStyle: this.fillStyle });
      },
      fillText(...text) {
        calls.push({
          method: 'fillText',
          text,
          fillStyle: this.fillStyle,
          font: this.font,
          textAlign: this.textAlign,
        });
      },
    };
    const { id, view } = makeView({ canvasContext: () => context });
    // Use non-default dimensions so a hard-coded clear cannot pass.
    id('stage').width = 960;
    id('stage').height = 540;
    function assertPaint(message, paintedTheme) {
      const [background, kicker, text] =
        paintedTheme === 'dark'
          ? ['#101b2a', '#cfae84', '#c4d0d1']
          : ['#f6f1e8', '#a0672a', '#3f4c57'];
      assert.deepEqual(calls.splice(0), [
        { method: 'fillRect', bounds: [0, 0, 960, 540], fillStyle: background },
        {
          method: 'fillText',
          text: ['RELGRAPH  /  DIRECTOR STUDIO', 640, 330],
          fillStyle: kicker,
          font: '600 13px system-ui',
          textAlign: 'center',
        },
        {
          method: 'fillText',
          text: [message, 640, 372],
          fillStyle: text,
          font: '22px system-ui',
          textAlign: 'center',
        },
      ]);
      assert.equal(context.textAlign, 'left', 'restore alignment after drawing');
    }
    const otherTheme = theme === 'dark' ? 'light' : 'dark';
    view.paintEmptyStage('未加载', theme);
    assertPaint('未加载', theme);
    view.repaintEmptyStage(otherTheme);
    assertPaint('未加载', otherTheme);
    view.paintEmptyStage('加载失败，请重试', otherTheme);
    assertPaint('加载失败，请重试', otherTheme);
    view.repaintEmptyStage(theme);
    assertPaint('加载失败，请重试', theme);
  });
}
