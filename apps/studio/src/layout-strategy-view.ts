import { uiElement, uiStatus } from './i18n.js';
import {
  DEFAULT_LAYOUT_SETTINGS,
  displayNodeText,
  LAYOUT_MODES,
  LAYOUT_TYPES,
  type LayoutMode,
  type LayoutSettings,
  type LayoutType,
  type DirectorFrameState,
  type ProjectConfig,
} from '@relgraph/core';
// One label per strategy and policy the core knows: adding one there without
// naming it here does not compile, and the menus cannot offer what it lacks.
const TYPE_LABELS: Record<LayoutType, string> = {
  manual: '手动 · 保留微调',
  auto: '自动 · 按结构选择',
  force: '力导向 · 聚类',
  layered: '分层 · 自上而下',
  flow: '流向 · 从左到右',
  tree: '树 · 向右展开',
  mindmap: '思维导图 · 向两侧展开',
  timeline: '时间轴 · 按时间排开',
  radial: '放射 · 以核心为圆心',
  circle: '环形',
  grid: '网格 · 保持顺序',
};
const MODE_LABELS: Record<LayoutMode, string> = {
  preserve: '保留现有坐标',
  missing: '只填补缺失坐标',
  rearrange: '重排未锁定节点',
};
interface Actions {
  preview(settings: LayoutSettings): void;
  apply(): void;
  cancel(): void;
  lock(id: string, locked: boolean): void;
  draftChanged?(): void;
}
export function createLayoutStrategyView(doc: Document, host: HTMLElement, actions: Actions) {
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = '',
  ): HTMLElementTagNameMap[K] => {
    return uiElement(doc, tag, text);
  };
  const title = el('h2', '布局 · 预览后应用');
  title.className = 'card-title';
  host.append(title);
  const select = (id: string, label: string, options: [string, string][]) => {
    const l = el('label', label),
      s = el('select');
    s.id = id;
    for (const [value, text] of options) {
      const o = el('option', text);
      o.value = value;
      s.append(o);
    }
    l.append(s);
    host.append(l);
    return s;
  };
  const type = select(
    'strategyType',
    '策略',
    LAYOUT_TYPES.map((value) => [value, TYPE_LABELS[value]]),
  );
  const mode = select(
    'strategyMode',
    '坐标策略',
    LAYOUT_MODES.map((value) => [value, MODE_LABELS[value]]),
  );
  const number = (id: string, label: string, min: string, max: string, value: string) => {
    const l = el('label', label),
      input = el('input');
    input.id = id;
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.value = value;
    l.append(input);
    host.append(l);
    return input;
  };
  const seed = number('strategySeed', 'Seed', '0', '4294967295', '0'),
    spacing = number('strategySpacing', '间距', '64', '400', '160'),
    iterations = number('strategyIterations', '力导向迭代次数', '0', '2000', '160');
  const nodes = select('strategyNode', '当前可见节点 · 锁定', []),
    lock = el('input');
  lock.id = 'strategyLock';
  lock.type = 'checkbox';
  const l = el('label', '锁定选中节点的当前坐标');
  l.append(lock);
  host.append(l);
  const note = el('p', '布局在播放前计算。分层与流向表示连接结构，不推断家谱世代。');
  note.className = 'muted';
  host.append(note);
  const button = (id: string, text: string, fn: () => void) => {
    const b = el('button', text);
    b.id = id;
    b.type = 'button';
    b.addEventListener('click', fn);
    host.append(b);
    return b;
  };
  let settings: LayoutSettings = DEFAULT_LAYOUT_SETTINGS,
    signature = '',
    enabled = false;
  // A locale-only render must not erase a failed preview/validation message.
  // Store the source message, never the translated label.
  let validationMessage: string | null = null;
  let hintMessage =
    '静态确定性布局 · 保留 = 不移动；填补 = 仅缺失；重排 = 移动未锁定节点。自动 = 按图的结构选择策略。';
  const refreshNote = () => {
    const message = uiStatus(validationMessage ?? hintMessage);
    if (note.textContent !== message) note.textContent = message;
  };
  const clearValidation = () => {
    if (validationMessage !== null) {
      validationMessage = null;
      refreshNote();
    }
  };
  const preview = button('strategyPreview', '预览布局', () => {
    if (!enabled) return;
    if ([seed, spacing, iterations].some((input) => !input.value.trim())) {
      validationMessage = '参数不能为空。';
      refreshNote();
      return;
    }
    clearValidation();
    actions.preview({
      ...settings,
      type: type.value as LayoutSettings['type'],
      mode: mode.value as LayoutSettings['mode'],
      seed: Number(seed.value),
      spacing: Number(spacing.value),
      iterations: Number(iterations.value),
    });
  });
  const apply = button('strategyApply', '应用布局', actions.apply),
    cancel = button('strategyCancel', '取消预览', actions.cancel);
  const syncLock = () => {
    lock.checked = settings.locked.includes(nodes.value);
    lock.disabled = !enabled || !nodes.value;
  };
  nodes.addEventListener('change', syncLock);
  lock.addEventListener('change', () => {
    if (nodes.value) actions.lock(nodes.value, lock.checked);
  });
  for (const input of [type, mode, seed, spacing, iterations]) {
    input.addEventListener('change', () => {
      clearValidation();
      actions.cancel();
      actions.draftChanged?.();
    });
    input.addEventListener('input', () => {
      clearValidation();
      actions.draftChanged?.();
    });
  }
  return {
    hasPendingDraft() {
      return (
        enabled &&
        (type.value !== settings.type ||
          mode.value !== settings.mode ||
          seed.value !== String(settings.seed) ||
          spacing.value !== String(settings.spacing) ||
          iterations.value !== String(settings.iterations))
      );
    },
    render(
      frame: DirectorFrameState | null,
      next: LayoutSettings | undefined,
      pending: boolean,
      loading: boolean,
      config?: ProjectConfig,
    ) {
      enabled = Boolean(frame) && !loading;
      settings = next ?? DEFAULT_LAYOUT_SETTINGS;
      const safe = frame?.view.nodes ?? [],
        sig = JSON.stringify(
          safe.map((n) => [n.id, displayNodeText(config, n.id)?.label ?? n.label]),
        );
      if (signature !== sig) {
        const selected = nodes.value;
        signature = sig;
        nodes.replaceChildren(
          ...safe.map((n) => {
            const o = doc.createElement('option');
            o.textContent = displayNodeText(config, n.id)?.label ?? n.label;
            o.value = n.id;
            return o;
          }),
        );
        nodes.value = safe.some((n) => n.id === selected) ? selected : (safe[0]?.id ?? '');
      }
      syncLock();
      for (const input of [type, mode, seed, spacing, iterations, nodes]) input.disabled = !enabled;
      preview.disabled = !enabled;
      apply.disabled = !enabled || !pending;
      cancel.disabled = !enabled || !pending;
      hintMessage = pending
        ? '临时预览 · 尚未保存。请应用或取消；可撤销已应用布局。'
        : '静态确定性布局 · 保留 = 不移动；填补 = 仅缺失；重排 = 移动未锁定节点。自动 = 按图的结构选择策略。';
      refreshNote();
    },
    reset(next: LayoutSettings | undefined) {
      validationMessage = null;
      settings = next ?? DEFAULT_LAYOUT_SETTINGS;
      type.value = settings.type;
      mode.value = settings.mode;
      seed.value = String(settings.seed);
      spacing.value = String(settings.spacing);
      iterations.value = String(settings.iterations);
      refreshNote();
    },
    error(message: string) {
      validationMessage = message;
      refreshNote();
    },
  };
}
