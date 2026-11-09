import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createWorkspaceShellView } from '../apps/studio/src/workspace-shell-view.ts';
import { createSimulatedStudioDom } from './helpers/studio-dom.mjs';

function makeView() {
  const dom = createSimulatedStudioDom();
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

test('empty Canvas uses the existing stage copy and remains theme-sensitive', () => {
  const { view } = makeView();
  view.paintEmptyStage('未加载', 'dark');
  view.repaintEmptyStage('light');
});
