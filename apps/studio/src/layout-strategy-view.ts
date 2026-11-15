import { uiElement, uiStatus, uiText } from './i18n.js';
import {
  DEFAULT_LAYOUT_SETTINGS,
  displayNodeText,
  LAYOUT_MODES,
  LAYOUT_TYPES,
  layoutFit,
  strategyParameters,
  type LayoutMode,
  type LayoutFitNote,
  type LayoutParameter,
  type LayoutPlan,
  type LayoutReason,
  type LayoutSettings,
  type LayoutType,
  type DirectorFrameState,
  type DrawingOrigin,
  type ProjectConfig,
  type StrategyFit,
  type VisualGraph,
} from '@relgraph/core';
// One label per strategy and policy the core knows: adding one there without
// naming it here does not compile, and the menus cannot offer what it lacks.
const TYPE_LABELS: Record<LayoutType, string> = {
  // Not a description of the picture (W2): the strategy that keeps it.
  manual: '保留当前画面 · 手动微调',
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
// Why the picture was drawn with another engine than the one chosen.
const REASON_LABELS: Record<LayoutReason, string> = {
  kept: '（保留现有坐标）',
  diagram: '（按图的类型）',
  structure: '（按图的结构）',
  size: '（节点过多，改用网格）',
  untimed: '（没有节点带日期，时间轴退回为树）',
};
/**
 * Why a preview was refused: a strategy that moves nothing must not look
 * like a pending change.
 */
export function unchangedLayoutMessage(settings: Pick<LayoutSettings, 'type' | 'mode'>): string {
  if (settings.type === 'manual') return '手动策略保留现有坐标：没有可预览的变化。';
  if (settings.mode === 'preserve')
    return '“保留现有坐标”不会移动任何节点：请改选“重排未锁定节点”或“只填补缺失坐标”。';
  return '此布局与当前画面相同：没有可应用的变化。';
}
/** Why a preview was refused: the time axis would have to move locked nodes. */
export function blockedLayoutMessage(names: readonly string[]): string {
  return BLOCKED_PREFIX + names.join('、') + BLOCKED_SUFFIX;
}
export const BLOCKED_PREFIX = '时间轴会横向移动已锁定的节点：',
  BLOCKED_SUFFIX = '。请先解锁它们，或改选其他布局。';
/** Why Reset was refused: the loaded time axis would have to move locked nodes. */
export function blockedResetMessage(names: readonly string[]): string {
  return BLOCKED_PREFIX + names.join('、') + RESET_BLOCKED_SUFFIX;
}
export const RESET_BLOCKED_SUFFIX = '。请先解锁它们，再重置。';
// Whether a strategy suits the graph and what it will do (W3).
const FIT_LABELS: Record<LayoutFitNote, string> = {
  kept: '保留当前画面，不移动任何节点。',
  auto: '将使用：',
  any: '适合任何图。',
  order: '适合任何图：按节点在文件中的顺序排列，不看关系。',
  dated: '适合：节点带有日期，按时间排开。',
  untimed: '不适合：没有节点带日期，将改画为树。',
  forest: '适合：关系构成树，没有环。',
  cycles: '不适合：关系有环，将沿生成树排布，其余关系不参与定位。',
  acyclic: '适合：关系有方向且没有回路。',
  cyclic: '不适合：有方向的关系形成回路，回路中的节点会排在同一层。',
  feedback: '适合：关系有方向；回路中返回的关系不参与分层。',
  undirected: '不适合：多数关系没有方向，层次只能由连接推断。',
  unrelated: '不适合：图中没有关系，节点会排成紧凑的一组。',
};
const UNSUITED = '（不适合此图）';
function fitText(fit: StrategyFit): string {
  if (fit.note === 'auto' && fit.engine)
    return (
      uiText(FIT_LABELS.auto) +
      uiText(TYPE_LABELS[fit.engine]) +
      (fit.reason ? uiText(REASON_LABELS[fit.reason]) : '')
    );
  return uiText(FIT_LABELS[fit.note]);
}
/** What drew the picture on screen, in the workspace's words (W2). */
function originText(origin: DrawingOrigin, adjusted: boolean): string {
  const body =
    origin.kind === 'strategy'
      ? uiText('已应用：') + uiText(TYPE_LABELS[origin.type])
      : origin.kind === 'structure'
        ? uiText('载入时自动排布：') +
          uiText(TYPE_LABELS[origin.engine]) +
          uiText(REASON_LABELS[origin.reason])
        : origin.kind === 'partial'
          ? uiText('文档保存的坐标；') + origin.missing + uiText(' 个没有坐标的节点排在旁边')
          : uiText('文档保存的坐标');
  return uiText('当前画面：') + body + (adjusted ? uiText('，并有手动微调') : '');
}
const MODE_LABELS: Record<LayoutMode, string> = {
  preserve: '保留现有坐标',
  missing: '只填补缺失坐标',
  rearrange: '重排未锁定节点',
};
/**
 * What the panel knows about the loaded graph: the settings each strategy
 * reads for it (`strategyParameters`).
 */
export interface LayoutPanelContext {
  parameters: Readonly<Record<LayoutType, readonly LayoutParameter[]>>;
  /** Whether each strategy suits the graph, and what it will do (`layoutFit`). */
  fit: Readonly<Record<LayoutType, StrategyFit>>;
}
/** The panel's knowledge of a graph, computed once when it loads. */
export function layoutPanelContext(graph: VisualGraph): LayoutPanelContext {
  const parameters = Object.fromEntries(
    LAYOUT_TYPES.map((type) => [type, strategyParameters(graph, type)]),
  ) as Record<LayoutType, readonly LayoutParameter[]>;
  return { parameters, fit: layoutFit(graph).strategies };
}
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
  // The disclosure's summary ("布局策略 · 预览后应用") is the panel's one
  // heading: the panel adds none of its own.
  // First, what drew the picture now on screen (W2).
  const drawnLine = el('p');
  drawnLine.id = 'strategyDrawn';
  drawnLine.className = 'muted strategy-drawn';
  drawnLine.hidden = true;
  host.append(drawnLine);
  let drawn: { origin: DrawingOrigin; adjusted: boolean } | null = null;
  const refreshDrawn = () => {
    const text = drawn ? originText(drawn.origin, drawn.adjusted) : '';
    if (drawnLine.textContent !== text) drawnLine.textContent = text;
    if (drawnLine.hidden !== !drawn) drawnLine.hidden = !drawn;
  };
  // The label around each control, so a setting the chosen strategy does not
  // read can be hidden with its control.
  const labels = new Map<HTMLElement, HTMLLabelElement>();
  const select = (id: string, label: string, options: [string, string][]) => {
    const l = el('label', label),
      s = el('select');
    labels.set(s, l);
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
  // The menu marks the strategies that do not suit the graph, so its labels
  // are written here, not by the static translation pass.
  const typeOptions = new Map<LayoutType, HTMLOptionElement>();
  for (const option of type.children as unknown as Iterable<HTMLOptionElement>) {
    option.removeAttribute('data-ui-key');
    typeOptions.set(option.value as LayoutType, option);
  }
  const fitLine = el('p');
  fitLine.id = 'strategyFit';
  fitLine.className = 'muted strategy-fit';
  fitLine.hidden = true;
  host.append(fitLine);
  const mode = select(
    'strategyMode',
    '坐标策略',
    LAYOUT_MODES.map((value) => [value, MODE_LABELS[value]]),
  );
  const number = (id: string, label: string, min: string, max: string, value: string) => {
    const l = el('label', label),
      input = el('input');
    labels.set(input, l);
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
    spacing = number(
      'strategySpacing',
      '间距',
      '64',
      '400',
      String(DEFAULT_LAYOUT_SETTINGS.spacing),
    ),
    iterations = number(
      'strategyIterations',
      '力导向迭代次数',
      '0',
      '2000',
      String(DEFAULT_LAYOUT_SETTINGS.iterations),
    );
  const nodes = select('strategyNode', '当前可见节点 · 锁定', []),
    lock = el('input');
  lock.id = 'strategyLock';
  lock.type = 'checkbox';
  const l = el('label', '锁定选中节点的当前坐标');
  l.append(lock);
  host.append(l);
  const note = el('p', '布局在播放前计算。分层与流向表示连接结构，不推断家谱世代。');
  note.id = 'strategyNote';
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
    enabled = false,
    context: LayoutPanelContext | null = null;
  const parameterInputs: Record<LayoutParameter, HTMLInputElement> = {
    seed,
    spacing,
    iterations,
  };
  // The settings the chosen strategy reads. Without a graph every one is
  // shown; `manual` reads none and ignores the coordinate policy.
  const chosenType = () => type.value as LayoutType;
  const reads = (parameter: LayoutParameter): boolean =>
    !context || context.parameters[chosenType()].includes(parameter);
  const usesPolicy = () => !context || chosenType() !== 'manual';
  const syncFields = () => {
    for (const parameter of ['seed', 'spacing', 'iterations'] as const) {
      const label = labels.get(parameterInputs[parameter])!,
        hidden = !reads(parameter);
      if (label.hidden !== hidden) label.hidden = hidden;
    }
    const policy = labels.get(mode)!;
    if (policy.hidden === usesPolicy()) policy.hidden = !usesPolicy();
    for (const [value, option] of typeOptions) {
      const text =
        uiText(TYPE_LABELS[value]) + (context?.fit[value].suits === false ? uiText(UNSUITED) : '');
      if (option.textContent !== text) option.textContent = text;
    }
    const fit = context?.fit[chosenType()],
      text = fit ? fitText(fit) : '';
    if (fitLine.textContent !== text) fitLine.textContent = text;
    if (fitLine.hidden !== !fit) fitLine.hidden = !fit;
    if (fit && fitLine.getAttribute('data-suits') !== String(fit.suits))
      fitLine.setAttribute('data-suits', String(fit.suits));
  };
  /** A setting as the preview receives it: the input when shown, else the stored value. */
  const parameterValue = (parameter: LayoutParameter): number =>
    reads(parameter) ? Number(parameterInputs[parameter].value) : settings[parameter];
  // A locale-only render must not erase a failed preview/validation message.
  // Store the source message, never the translated label.
  let validationMessage: string | null = null;
  // The engine that drew the pending preview, and why, when it is not the one chosen.
  let outcome: Pick<LayoutPlan, 'engine' | 'reason'> | null = null,
    pendingPreview = false;
  let hintMessage =
    '静态确定性布局 · 保留 = 不移动；填补 = 仅缺失；重排 = 移动未锁定节点。自动 = 按图的结构选择策略。';
  const outcomeText = (): string => {
    if (!outcome?.engine || !pendingPreview || validationMessage !== null) return '';
    return (
      ' ' +
      uiText('实际绘制：') +
      uiText(TYPE_LABELS[outcome.engine]) +
      (outcome.reason ? uiText(REASON_LABELS[outcome.reason]) : '')
    );
  };
  const refreshNote = () => {
    const message = uiStatus(validationMessage ?? hintMessage) + outcomeText();
    if (note.textContent !== message) note.textContent = message;
  };
  // The inputs of a preview refused because it would change nothing: such a
  // draft has nothing to lose, so it is not an unsaved change.
  let inertDraft: string | null = null;
  const draftKey = () =>
    JSON.stringify([type.value, mode.value, seed.value, spacing.value, iterations.value]);
  const clearValidation = () => {
    inertDraft = null;
    if (validationMessage !== null) {
      validationMessage = null;
      refreshNote();
    }
  };
  const preview = button('strategyPreview', '预览布局', () => {
    if (!enabled) return;
    const shown = (['seed', 'spacing', 'iterations'] as const).filter(reads);
    if (shown.some((parameter) => !parameterInputs[parameter].value.trim())) {
      validationMessage = '参数不能为空。';
      refreshNote();
      return;
    }
    clearValidation();
    actions.preview({
      ...settings,
      type: type.value as LayoutSettings['type'],
      mode: usesPolicy() ? (mode.value as LayoutSettings['mode']) : settings.mode,
      seed: parameterValue('seed'),
      spacing: parameterValue('spacing'),
      iterations: parameterValue('iterations'),
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
  type.addEventListener('change', syncFields);
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
        inertDraft !== draftKey() &&
        // A hidden setting is not read by the chosen strategy: editing it
        // earlier is not a draft the user can lose.
        (type.value !== settings.type ||
          (usesPolicy() && mode.value !== settings.mode) ||
          (['seed', 'spacing', 'iterations'] as const).some(
            (parameter) =>
              reads(parameter) && parameterInputs[parameter].value !== String(settings[parameter]),
          ))
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
      pendingPreview = pending;
      if (!pending) outcome = null;
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
      refreshDrawn();
      syncFields();
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
      syncFields();
      refreshNote();
    },
    /**
     * What drew the picture on screen: how the document was drawn, or the
     * strategy last applied, and whether nodes were moved by hand since.
     */
    drawn(origin: DrawingOrigin | null, adjusted = false) {
      drawn = origin && { origin, adjusted };
      refreshDrawn();
    },
    /** What the panel knows about the loaded graph; null when none is loaded. */
    describe(next: LayoutPanelContext | null) {
      context = next;
      syncFields();
    },
    error(message: string) {
      validationMessage = message;
      refreshNote();
    },
    /** Refuse a preview that would change nothing; its inputs are not a pending draft. */
    unchanged(message: string) {
      validationMessage = message;
      inertDraft = draftKey();
      refreshNote();
    },
    /** Name the engine that drew the preview being shown. */
    outcome(plan: Pick<LayoutPlan, 'engine' | 'reason'> | null) {
      outcome = plan && { engine: plan.engine, reason: plan.reason };
      refreshNote();
    },
  };
}
