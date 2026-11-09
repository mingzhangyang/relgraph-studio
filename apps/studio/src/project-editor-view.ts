import {
  nodeAppearance,
  appearanceOrigin,
  displayNodeText,
  displayEdgeText,
  type ProjectConfig,
  type DirectorFrameState,
  type VisualNode,
  type VisualEdge,
} from '@relgraph/core';
import { hitDisplayList, type DisplayList } from '@relgraph/render';
import {
  editAppearance,
  inspectorAppearance,
  inspectorOrigin,
  clearAppearance,
  copyConfig,
  setNodeImage,
  inheritNodeImage,
  type Selection,
  type Scope,
} from './project-editor-model.js';

interface Actions {
  /** True only when the coordinator accepted the proposed configuration. */
  change(config: ProjectConfig): boolean;
  undo(): void;
  redo(): void;
  save(): void;
  pause(): void;
  uploadImage(file: File, nodeId: string): Promise<void>;
  draftChanged?(): void;
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
/**
 * Label only currently projected choices; never consult the unfiltered source
 * graph for a relationship's endpoints. IDs disambiguate parallel relations.
 */
export function visibleObjectEntries(
  frame: Pick<DirectorFrameState, 'view'> | null,
  config: ProjectConfig,
  kind: 'node' | 'edge',
): { id: string; label: string }[] {
  if (!frame) return [];
  if (kind === 'node')
    return frame.view.nodes.map((node) => ({
      id: node.id,
      label: displayNodeText(config, node.id)?.label ?? node.label,
    }));
  const names = new Map(
    frame.view.nodes.map((node) => [
      node.id,
      displayNodeText(config, node.id)?.label ?? node.label,
    ]),
  );
  return frame.view.edges.map((edge) => {
    const from = names.get(edge.source);
    const to = names.get(edge.target);
    const endpoints =
      from === undefined || to === undefined
        ? '端点未显示'
        : `${from} ${edge.directed ? '→' : '—'} ${to}`;
    const label = displayEdgeText(config, edge.id)?.label ?? edge.label ?? edge.kind;
    return { id: edge.id, label: `${label} · ${endpoints} · ID: ${edge.id}` };
  });
}

/** Stable controls; only safe object options are reconciled when projection changes. */
export function createProjectEditor(doc: Document, host: HTMLElement, actions: Actions) {
  let config: ProjectConfig = {},
    frame: DirectorFrameState | null = null,
    selection: Selection = null,
    signature = '',
    fieldSignature = '';
  let kind: 'node' | 'edge' = 'node';
  // Keep uncommitted and rejected edits outside the DOM. Selection changes,
  // playback redraws and focus loss must not silently discard user input.
  // A number input can expose value === '' while validity.badInput is true.
  // Preserve validity with the draft; a bare string cannot distinguish that
  // state from an intentional empty override.
  const drafts = new Map<string, { value: string; badInput: boolean }>();
  let renderedContext = '';
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
  label.addEventListener('input', () =>
    rememberDraft('label', label.value, expectedText('label')),
  );
  const description = el('textarea');
  description.id = 'visualDescription';
  description.maxLength = 2000;
  const descWrap = el('label', '显示说明');
  descWrap.append(description);
  host.append(descWrap);
  description.addEventListener('input', () =>
    rememberDraft('description', description.value, expectedText('description')),
  );
  let buttonHost = host;
  const button = (text: string, id: string, fn: () => void) => {
    const b = el('button', text);
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', fn);
    buttonHost.append(b);
    return b;
  };
  const imageSection = el('div'),
    imageLabel = el('label', '节点图片 · 仅当前节点'),
    imageFile = el('input'),
    imageStatus = el('p');
  imageStatus.id = 'visualImageStatus';
  // Announce asynchronous image processing and completion without repeatedly
  // announcing the same text on every playback-driven render.
  imageStatus.setAttribute('role', 'status');
  imageStatus.setAttribute('aria-live', 'polite');
  imageStatus.setAttribute('aria-atomic', 'true');
  imageFile.id = 'visualImageFile';
  imageFile.type = 'file';
  imageFile.accept = 'image/png,image/jpeg,image/webp';
  imageLabel.append(imageFile);
  imageSection.append(imageLabel, imageStatus);
  host.append(imageSection);
  let imageBusy = false;
  // A selection's ID can repeat after A -> B -> A; only its revision is unique.
  let selectionRevision = 0;
  const setSelection = (next: Selection) => {
    if (selection?.kind !== next?.kind || selection?.id !== next?.id) {
      ++selectionRevision;
      imageBusy = false;
    }
    selection = next;
  };
  const imageFit = el('select');
  imageFit.id = 'visualImageFit';
  for (const [value, text] of [
    ['cover', '填满 · 居中裁切'],
    ['contain', '完整显示 · 保留留白'],
  ]) {
    const option = el('option', text);
    option.value = value;
    imageFit.append(option);
  }
  const fitLabel = el('label', '图片适配');
  fitLabel.append(imageFit);
  imageSection.append(fitLabel);
  const removeImage = el('button', '移除图片');
  removeImage.type = 'button';
  removeImage.id = 'visualImageRemove';
  imageSection.append(removeImage);
  const inheritImage = el('button', '恢复继承图片');
  inheritImage.type = 'button';
  inheritImage.id = 'visualImageInherit';
  imageSection.append(inheritImage);
  imageFile.addEventListener('change', () => {
    const file = imageFile.files?.[0];
    imageFile.value = '';
    if (file && selection?.kind === 'node') void actions.uploadImage(file, selection.id);
  });
  removeImage.addEventListener('click', () => {
    const node = item();
    if (node && kind === 'node') actions.change(setNodeImage(config, node as VisualNode, null));
  });
  inheritImage.addEventListener('click', () => {
    const node = item();
    if (node && kind === 'node') actions.change(inheritNodeImage(config, node as VisualNode));
  });
  imageFit.addEventListener('change', () => {
    const node = item();
    if (node && kind === 'node')
      actions.change(editAppearance(config, 'node', node, 'object', 'imageFit', imageFit.value));
  });
  button('恢复原文', 'visualRestoreText', () => {
    if (!selection) return;
    // This is an explicit discard of the selected object's text edits.
    drafts.delete(draftKey('label'));
    drafts.delete(draftKey('description'));
    const next = copyConfig(config);
    delete next.text?.[kind === 'node' ? 'nodes' : 'edges']?.[selection.id];
    actions.change(next);
    actions.draftChanged?.();
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
  const draftKey = (field: string): string =>
    JSON.stringify([
      kind,
      selection?.id ?? null,
      field === 'label' || field === 'description' ? '' : scope.value,
      field,
    ]);
  const matchesValue = (value: string, expected: string, type?: string): boolean =>
    value === expected ||
    (type === 'number' &&
      value !== '' &&
      expected !== '' &&
      Number.isFinite(Number(value)) &&
      Number(value) === Number(expected));
  const expectedText = (field: 'label' | 'description'): string => {
    const selected = item();
    if (!selected) return '';
    const copy =
      kind === 'node' ? displayNodeText(config, selected.id) : displayEdgeText(config, selected.id);
    return field === 'label'
      ? (copy?.label ?? selected.label ?? '')
      : kind === 'node'
        ? (displayNodeText(config, selected.id)?.description ?? '')
        : '';
  };
  const expectedAppearance = (field: string): string =>
    String(
      (inspectorAppearance(config, kind, item(), scope.value as Scope) as Record<string, unknown>)[
        field
      ] ?? '',
    );
  const rememberDraft = (
    field: string,
    value: string,
    expected: string,
    type?: string,
    badInput = false,
  ): void => {
    const key = draftKey(field);
    if (!badInput && matchesValue(value, expected, type)) drafts.delete(key);
    else drafts.set(key, { value, badInput });
    actions.draftChanged?.();
  };
  const displayedValue = (field: string, expected: string, type?: string): string => {
    const key = draftKey(field);
    const pending = drafts.get(key);
    if (pending === undefined) return expected;
    if (!pending.badInput && matchesValue(pending.value, expected, type)) {
      drafts.delete(key);
      return expected;
    }
    return pending.value;
  };
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
      reset.addEventListener('click', () => {
        drafts.delete(draftKey(key));
        input.setAttribute('aria-invalid', 'false');
        update(key, undefined);
        actions.draftChanged?.();
      });
      input.addEventListener('input', () => {
        const badInput = input.type === 'number' && input.validity?.badInput === true;
        rememberDraft(key, input.value, expectedAppearance(key), input.type, badInput);
        input.setAttribute('aria-invalid', String(badInput));
      });
      input.addEventListener('change', () => {
        const raw = input.value;
        const draft = draftKey(key);
        // Blurring an incomplete number may sanitize its DOM value to '' and
        // clear badInput without another input event. Retain the earlier flag
        // until the user actually enters a valid replacement or explicitly resets.
        const badInput =
          input.type === 'number' &&
          (input.validity?.badInput === true || drafts.get(draft)?.badInput === true);
        if (badInput) {
          drafts.set(draft, { value: raw, badInput: true });
          input.setAttribute('aria-invalid', 'true');
          error.textContent = '数字输入尚未完成，请修正或恢复继承后再保存。';
          actions.draftChanged?.();
          return;
        }
        const val =
          raw === ''
            ? undefined
            : ['size', 'borderWidth', 'fontSize', 'fontWeight', 'width', 'curve'].includes(key)
              ? Number(raw)
              : key === 'showLabel'
                ? raw === 'true'
                : raw;
        // Clearing an override intentionally inherits a nonempty value.
        // Use validation's outcome instead of comparing raw input against the
        // inherited appearance, which would report a false pending draft.
        drafts.delete(draft);
        const accepted = update(key, val);
        if (accepted) {
          // The browser may still regard this input as focused during change.
          // Display the committed/inherited value immediately in either case.
          input.value = expectedAppearance(key);
          input.setAttribute('aria-invalid', 'false');
        } else if (!matchesValue(raw, expectedAppearance(key), input.type)) {
          drafts.set(draft, { value: raw, badInput: false });
          input.value = raw;
        }
        actions.draftChanged?.();
      });
      row.append(input, origin, reset);
      fields.append(row);
      controls.set(key, { input, origin, row });
    }
  };
  const render = () => {
    buildFields();
    const candidates = kind === 'node' ? (frame?.view.nodes ?? []) : (frame?.view.edges ?? []);
    if (selection && !candidates.some((n) => n.id === selection!.id)) setSelection(null);
    const entries = visibleObjectEntries(frame, config, kind);
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
    const context = JSON.stringify([kind, selection?.id ?? null, scope.value]);
    const contextChanged = renderedContext !== context;
    const selected = item(),
      disabled = !frame || (!selected && scope.value !== 'global');
    const text = selected
      ? kind === 'node'
        ? displayNodeText(config, selected.id)
        : displayEdgeText(config, selected.id)
      : undefined;
    // Only preserve focus within the same object/scope; switching context
    // must show that context's own pending draft (if any), not the old input.
    if (!selected || contextChanged || doc.activeElement !== label)
      label.value = selected
        ? displayedValue('label', text?.label ?? selected.label ?? '')
        : '';
    if (!selected || contextChanged || doc.activeElement !== description)
      description.value = selected
        ? displayedValue(
            'description',
            kind === 'node' ? ((text as { description?: string })?.description ?? '') : '',
          )
        : '';
    label.disabled = !selected;
    description.disabled = !selected || kind !== 'node';
    descWrap.hidden = kind !== 'node';
    provenance.textContent = selected
      ? `类别：${selected.kind}` +
        (kind === 'edge'
          ? ` · ${'directed' in selected && selected.directed ? '有向' : '无向'} · ${entries.find((entry) => entry.id === selected.id)?.label ?? '端点未显示'} · 关系事实保持原样`
          : '')
      : '全局样式可作用于未来对象，列表只显示当前投影。';
    const resolved = inspectorAppearance(config, kind, selected, scope.value as Scope);
    imageSection.hidden = kind !== 'node';
    const imageStyle =
      selected && kind === 'node' ? nodeAppearance(config, selected as VisualNode) : {};
    const asset = imageStyle.image ? config.assets?.[imageStyle.image] : undefined;
    imageFile.disabled = !selected || imageBusy;
    imageFit.disabled = !selected || !asset || imageBusy;
    removeImage.disabled = !selected || !asset;
    inheritImage.disabled = !selected;
    imageFit.value = imageStyle.imageFit ?? 'cover';
    const nextImageStatus = imageBusy
      ? '正在本地处理图片…'
      : asset
        ? `已设置图片 · ${asset.width} × ${asset.height} · ${appearanceOrigin(config.nodes, selected?.kind ?? '', selected?.id ?? '', 'image')}`
        : 'PNG / JPEG / WebP · 最长边保存为 256 像素 · 不上传服务器';
    if (imageStatus.textContent !== nextImageStatus) imageStatus.textContent = nextImageStatus;
    for (const [key, c] of controls) {
      c.input.disabled = disabled || (key === 'head' && frame?.view.domain === 'biology');
      c.origin.textContent = inspectorOrigin(config, kind, selected, scope.value as Scope, key);
      if (contextChanged || doc.activeElement !== c.input)
        c.input.value = displayedValue(
          key,
          String((resolved as Record<string, unknown>)[key] ?? ''),
          c.input.type,
        );
      c.input.setAttribute(
        'aria-invalid',
        String(drafts.get(draftKey(key))?.badInput === true || c.input.validity?.badInput === true),
      );
    }
    renderedContext = context;
    // Recompute dirty state only after selection and its controls agree.
    actions.draftChanged?.();
  };
  preset.addEventListener('change', () =>
    actions.change({ ...config, preset: preset.value as ProjectConfig['preset'] }),
  );
  kindSelect.addEventListener('change', () => {
    kind = kindSelect.value as typeof kind;
    setSelection(null);
    render();
  });
  objects.addEventListener('change', () => {
    actions.pause();
    setSelection(objects.value ? { kind, id: objects.value } : null);
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
    const draft = draftKey(field);
    drafts.delete(draft);
    const accepted = actions.change(next);
    if (!accepted && value !== expectedText(field)) {
      drafts.set(draft, { value, badInput: false });
      if (field === 'label') label.value = value;
      else description.value = value;
    }
    actions.draftChanged?.();
  };
  label.addEventListener('change', () => changeText('label', label.value));
  description.addEventListener('change', () => changeText('description', description.value));
  buttonHost = el('div');
  buttonHost.className = 'property-actions';
  host.append(buttonHost);
  button('清除当前范围样式', 'visualClear', () => {
    for (const key of controls.keys()) drafts.delete(draftKey(key));
    actions.change(clearAppearance(config, kind, item(), scope.value as Scope));
    actions.draftChanged?.();
  });
  const undo = button('撤销', 'visualUndo', actions.undo),
    redo = button('重做', 'visualRedo', actions.redo);
  button('恢复默认画面', 'visualReset', () => {
    drafts.clear();
    actions.change({});
    actions.draftChanged?.();
  });
  button('保存项目 JSON', 'visualSave', actions.save);
  return {
    /** Detect unsent text/number drafts, including invalid values not accepted by core. */
    hasPendingDraft() {
      if (!frame) return false;
      // Also guard drafts belonging to other selections and scopes.
      if (drafts.size > 0) return true;
      const selected = item();
      if (selected) {
        const copy = kind === 'node'
          ? displayNodeText(config, selected.id)
          : displayEdgeText(config, selected.id);
        if (!label.disabled && label.value !== (copy?.label ?? selected.label ?? '')) return true;
        if (
          kind === 'node' &&
          !description.disabled &&
          description.value !== (displayNodeText(config, selected.id)?.description ?? '')
        ) return true;
      }
      const resolved = inspectorAppearance(config, kind, selected, scope.value as Scope);
      for (const [key, control] of controls) {
        if (control.input.disabled) continue;
        // Check native validity as well as stored drafts. The latter protects
        // incomplete tokens once focus is lost or a node/scope is switched.
        if (control.input.type === 'number' && control.input.validity?.badInput === true)
          return true;
        const expected = String((resolved as Record<string, unknown>)[key] ?? '');
        if (!matchesValue(control.input.value, expected, control.input.type)) return true;
      }
      return false;
    },
    isImageBusy() {
      return imageBusy;
    },
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
    selectedNodeId() {
      return selection?.kind === 'node' ? selection.id : null;
    },
    selectionRevision() {
      return selectionRevision;
    },
    imageBusy(value: boolean) {
      imageBusy = value;
      render();
      actions.draftChanged?.();
    },
    clear() {
      imageBusy = false;
      drafts.clear();
      renderedContext = '';
      setSelection(null);
      signature = '';
      frame = null;
      config = {};
      render();
    },
    error(message: string) {
      error.textContent = message;
    },
    pick(list: DisplayList, point: { x: number; y: number }) {
      const hit = hitDisplayList(list, point);
      if (hit) {
        // Native blur commits pending change events while the old object is selected.
        const active = doc.activeElement;
        if (active && host.contains(active)) (active as HTMLElement).blur();
        actions.pause();
        setSelection({ kind: hit.kind, id: hit.id });
        kind = hit.kind;
        kindSelect.value = kind;
        render();
      }
    },
  };
}
