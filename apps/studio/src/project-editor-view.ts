import {
  appearanceOrigin,
  nodeAppearance,
  edgeAppearance,
  displayNodeText,
  displayEdgeText,
  type ProjectConfig,
  type DirectorFrameState,
  type VisualNode,
  type VisualEdge,
} from '@relgraph/core';
import type { DisplayList } from '@relgraph/render';
import {
  editAppearance,
  clearAppearance,
  copyConfig,
  type Selection,
  type Scope,
} from './project-editor-model.js';

interface Actions {
  change(config: ProjectConfig): void;
  undo(): void;
  redo(): void;
  save(): void;
  pause(): void;
}
const nodeFields: [string, string, string | readonly string[]][] = [
  ['shape', '形状', ['circle', 'pill', 'diamond']],
  ['size', '半径 · px', 'number'],
  ['fill', '填充色', 'color'],
  ['border', '边框色', 'color'],
  ['borderWidth', '边框宽度', 'number'],
  ['fontSize', '字号', 'number'],
  ['fontWeight', '字重', ['400', '600']],
  ['textColor', '文字色', 'color'],
  ['textPosition', '文字位置', ['auto', 'top', 'bottom', 'left', 'right']],
];
const edgeFields: [string, string, string | readonly string[]][] = [
  ['color', '线条颜色', 'color'],
  ['width', '线宽', 'number'],
  ['dash', '虚实', ['solid', 'dashed', 'dotted']],
  ['head', '端点', ['arrow', 'bar', 'hollow-circle', 'none']],
  ['curve', '曲率 · 0 为直线', 'number'],
  ['showLabel', '显示标签', ['true', 'false']],
  ['fontSize', '标签字号', 'number'],
  ['fontWeight', '标签字重', ['400', '600']],
  ['textColor', '标签文字色', 'color'],
];
/** Stable controls; only safe object options are reconciled when projection changes. */
export function createProjectEditor(doc: Document, host: HTMLElement, actions: Actions) {
  let config: ProjectConfig = {},
    frame: DirectorFrameState | null = null,
    selection: Selection = null,
    signature = '',
    fieldSignature = '';
  let kind: 'node' | 'edge' = 'node';
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = '',
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (text) e.textContent = text;
    return e;
  };
  const heading = el('h2', '画面与属性');
  heading.className = 'card-title';
  host.append(heading);
  const note = el('p', '选择画面对象或使用列表。空值继承；↺ 清除覆盖。');
  note.className = 'muted';
  host.append(note);
  const makeSelect = (id: string, label: string, options: readonly [string, string][]) => {
    const l = el('label', label),
      s = el('select');
    s.id = id;
    for (const [v, t] of options) {
      const o = el('option', t);
      o.value = v;
      s.append(o);
    }
    l.append(s);
    host.append(l);
    return s;
  };
  const preset = makeSelect('visualPreset', '协调预设', [
    ['editorial', '编辑 · 默认'],
    ['quiet', '安静 · 细线'],
    ['presentation', '演示 · 醒目'],
  ]);
  const kindSelect = makeSelect('visualKind', '对象类型', [
    ['node', '节点'],
    ['edge', '连线'],
  ]);
  const objects = makeSelect('visualObject', '当前安全可见对象', []);
  const scope = makeSelect('visualScope', '样式作用范围', [
    ['object', '单个对象'],
    ['category', '当前类别'],
    ['global', '全局默认'],
  ]);
  const provenance = el('p');
  provenance.id = 'visualFacts';
  provenance.className = 'muted';
  host.append(provenance);
  const copyNote = el('p', '显示文案 · 未自动核实。原始姓名、关系事实与来源证据保存在源数据中。');
  copyNote.className = 'muted';
  host.append(copyNote);
  const label = el('input');
  label.id = 'visualLabel';
  label.maxLength = 2000;
  const labelWrap = el('label', '显示名称 / 关系标签');
  labelWrap.append(label);
  host.append(labelWrap);
  const description = el('textarea');
  description.id = 'visualDescription';
  description.maxLength = 2000;
  const descWrap = el('label', '显示说明');
  descWrap.append(description);
  host.append(descWrap);
  let buttonHost = host;
  const button = (text: string, id: string, fn: () => void) => {
    const b = el('button', text);
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', fn);
    buttonHost.append(b);
    return b;
  };
  button('恢复原文', 'visualRestoreText', () => {
    if (!selection) return;
    const next = copyConfig(config);
    delete next.text?.[kind === 'node' ? 'nodes' : 'edges']?.[selection.id];
    actions.change(next);
  });
  const advanced = el('details'),
    summary = el('summary', '高级样式 · 继承与覆盖'),
    fields = el('div');
  fields.className = 'property-grid';
  advanced.append(summary, fields);
  host.append(advanced);
  const error = el('p');
  error.id = 'visualError';
  error.setAttribute('role', 'status');
  host.append(error);
  const controls = new Map<
    string,
    { input: HTMLInputElement | HTMLSelectElement; origin: HTMLElement; row: HTMLElement }
  >();
  const item = (): VisualNode | VisualEdge | undefined =>
    selection
      ? (kind === 'node' ? frame?.view.nodes : frame?.view.edges)?.find(
          (n) => n.id === selection!.id,
        )
      : undefined;
  const update = (field: string, value: unknown) =>
    actions.change(editAppearance(config, kind, item(), scope.value as Scope, field, value));
  const buildFields = () => {
    if (fieldSignature === kind) return;
    fieldSignature = kind;
    controls.clear();
    fields.replaceChildren();
    for (const [key, title, type] of kind === 'node' ? nodeFields : edgeFields) {
      const row = el('label', title),
        input = typeof type === 'string' ? el('input') : el('select'),
        origin = el('small'),
        reset = el('button', '↺');
      input.id = 'visual-' + key;
      if (typeof type === 'string') {
        (input as HTMLInputElement).type = type === 'color' ? 'text' : type;
        (input as HTMLInputElement).placeholder =
          type === 'color' ? '#RRGGBB · 留空继承' : '留空继承';
        (input as HTMLInputElement).step = 'any';
      } else {
        const empty = el('option', '继承');
        empty.value = '';
        input.append(empty);
        for (const value of type) {
          const o = el('option', value);
          o.value = value;
          input.append(o);
        }
      }
      reset.type = 'button';
      reset.setAttribute('aria-label', '恢复继承：' + title);
      reset.addEventListener('click', () => update(key, undefined));
      input.addEventListener('change', () => {
        const raw = input.value;
        const val =
          raw === ''
            ? undefined
            : ['size', 'borderWidth', 'fontSize', 'fontWeight', 'width', 'curve'].includes(key)
              ? Number(raw)
              : key === 'showLabel'
                ? raw === 'true'
                : raw;
        update(key, val);
      });
      row.append(input, origin, reset);
      fields.append(row);
      controls.set(key, { input, origin, row });
    }
  };
  const render = () => {
    buildFields();
    const candidates = kind === 'node' ? (frame?.view.nodes ?? []) : (frame?.view.edges ?? []);
    if (selection && !candidates.some((n) => n.id === selection!.id)) selection = null;
    const entries = candidates.map((n) => ({
      id: n.id,
      label:
        kind === 'node'
          ? (displayNodeText(config, n.id)?.label ?? n.label)
          : (displayEdgeText(config, n.id)?.label ?? n.label ?? n.kind),
    }));
    const nextSignature = JSON.stringify([kind, entries]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      const blank = el('option', '— 请选择 —');
      blank.value = '';
      objects.replaceChildren(
        blank,
        ...entries.map((n) => {
          const o = el('option', n.label);
          o.value = n.id;
          return o;
        }),
      );
    }
    objects.value = selection?.id ?? '';
    preset.value = config.preset ?? 'editorial';
    const selected = item(),
      disabled = !frame || (!selected && scope.value !== 'global');
    const text = selected
      ? kind === 'node'
        ? displayNodeText(config, selected.id)
        : displayEdgeText(config, selected.id)
      : undefined;
    // Never overwrite the focused input during playback or redraw.
    if (!selected || doc.activeElement !== label)
      label.value = text?.label ?? selected?.label ?? '';
    if (!selected || doc.activeElement !== description)
      description.value =
        kind === 'node' ? ((text as { description?: string })?.description ?? '') : '';
    label.disabled = !selected;
    description.disabled = !selected || kind !== 'node';
    descWrap.hidden = kind !== 'node';
    provenance.textContent = selected
      ? `类别：${selected.kind}` +
        (kind === 'edge'
          ? ` · ${'directed' in selected && selected.directed ? '有向' : '无向'} · 关系事实保持原样`
          : '')
      : '全局样式可作用于未来对象，列表只显示当前投影。';
    const resolved = selected
      ? kind === 'node'
        ? nodeAppearance(config, selected as VisualNode)
        : edgeAppearance(config, selected as VisualEdge)
      : {};
    for (const [key, c] of controls) {
      c.input.disabled = disabled || (key === 'head' && frame?.view.domain === 'biology');
      const layers = kind === 'node' ? config.nodes : config.edges;
      c.origin.textContent = appearanceOrigin(
        layers as never,
        selected?.kind ?? '',
        selected?.id ?? '',
        key as never,
      );
      if (doc.activeElement !== c.input)
        c.input.value = String((resolved as Record<string, unknown>)[key] ?? '');
    }
  };
  preset.addEventListener('change', () =>
    actions.change({ ...config, preset: preset.value as ProjectConfig['preset'] }),
  );
  kindSelect.addEventListener('change', () => {
    kind = kindSelect.value as typeof kind;
    selection = null;
    render();
  });
  objects.addEventListener('change', () => {
    actions.pause();
    selection = objects.value ? { kind, id: objects.value } : null;
    render();
  });
  scope.addEventListener('change', render);
  const changeText = (field: 'label' | 'description', value: string) => {
    if (!selection) return;
    const next = copyConfig(config),
      collection = kind === 'node' ? 'nodes' : 'edges';
    next.text ??= {};
    const entries = (next.text[collection] ??= {});
    Object.defineProperty(entries, selection.id, {
      value: {
        ...(Object.hasOwn(entries, selection.id) ? entries[selection.id] : {}),
        [field]: value,
      },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    actions.change(next);
  };
  label.addEventListener('change', () => changeText('label', label.value));
  description.addEventListener('change', () => changeText('description', description.value));
  buttonHost = el('div');
  buttonHost.className = 'property-actions';
  host.append(buttonHost);
  button('清除当前范围样式', 'visualClear', () =>
    actions.change(clearAppearance(config, kind, item(), scope.value as Scope)),
  );
  const undo = button('撤销', 'visualUndo', actions.undo),
    redo = button('重做', 'visualRedo', actions.redo);
  button('恢复默认画面', 'visualReset', () => actions.change({}));
  button('保存项目 JSON', 'visualSave', actions.save);
  return {
    render(
      nextFrame: DirectorFrameState | null,
      nextConfig: ProjectConfig,
      canUndo = false,
      canRedo = false,
    ) {
      frame = nextFrame;
      config = nextConfig;
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
      render();
    },
    clear() {
      selection = null;
      signature = '';
      frame = null;
      config = {};
      render();
    },
    error(message: string) {
      error.textContent = message;
    },
    pick(list: DisplayList, point: { x: number; y: number }) {
      const stage = list.selection ?? [];
      const hit = [...stage]
        .reverse()
        .find((h) =>
          h.box
            ? point.x >= h.box.x &&
              point.x <= h.box.x + h.box.w &&
              point.y >= h.box.y &&
              point.y <= h.box.y + h.box.h
            : h.points?.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 9),
        );
      if (hit) {
        actions.pause();
        selection = { kind: hit.kind, id: hit.id };
        kind = hit.kind;
        kindSelect.value = kind;
        render();
      }
    },
  };
}
