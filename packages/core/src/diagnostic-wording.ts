/**
 * The wording of core's diagnostics, by layer and key, with the values each
 * one names carried as parameters. A key is the diagnostic's `code`, or
 * `CODE.variant` where one code has several wordings (`TYPE.array`,
 * `TYPE.boolean`, …); diagnostics carry the variant and the parameters, so a
 * workspace translates them by key instead of parsing the sentences.
 *
 * Layers whose messages are written in English only (`biology`, `graph`) are
 * not listed: their text is shown as written.
 */

/** A value a wording names: a field, a limit, a count, an id or the allowed values. */
export type DiagnosticParam = string | number | readonly string[];
export type DiagnosticParams = Readonly<Record<string, DiagnosticParam>>;

/** How one diagnostic reads in one language. */
export interface DiagnosticWording {
  message(params: DiagnosticParams): string;
  fix(params: DiagnosticParams): string;
}
type Text = string | ((params: DiagnosticParams) => string);
const render = (text: Text, params: DiagnosticParams): string =>
  typeof text === 'string' ? text : text(params);
/** A wording from fixed text or templates over the parameters. */
export function wording(message: Text, fix: Text): DiagnosticWording {
  return { message: (p) => render(message, p), fix: (p) => render(fix, p) };
}
/** A list parameter joined for display. */
export const listed = (value: DiagnosticParam | undefined, separator: string): string =>
  Array.isArray(value) ? value.join(separator) : String(value ?? '');

const zhList = (value: DiagnosticParam | undefined) => `可用：${listed(value, '、')}。`;

/** Literature: the schema scan (`structure`). Messages are English, fixes Chinese. */
export const STRUCTURE_WORDING = {
  'BROKEN_REF.rule': wording('Schema rule is invalid', '修复 Schema。'),
  'BROKEN_REF.ref': wording((p) => `Schema reference ${p.ref} is invalid`, '修复 Schema。'),
  'UNSUPPORTED_SCHEMA.keyword': wording(
    (p) => `Unsupported schema keyword ${p.keyword}`,
    '更新 Schema 校验器。',
  ),
  'UNSUPPORTED_SCHEMA.rule': wording('Unsupported schema rule', '更新 Schema 校验器。'),
  'UNSUPPORTED_SCHEMA.siblings': wording(
    'Schema reference has unsupported siblings',
    '更新 Schema 校验器。',
  ),
  TYPE: wording((p) => `Expected ${p.type}`, '修正字段类型。'),
  VERSION: wording(
    (p) => `Unsupported schemaVersion ${p.value}; supported: 0.1`,
    '请使用 0.1 数据，或升级播放器。',
  ),
  ENUM: wording((p) => `Invalid value ${p.value}`, '使用规范中的枚举值。'),
  PATTERN: wording(
    (p) => `Invalid value ${p.value}`,
    'id 使用小写 ASCII、数字与连字符；颜色使用 #RRGGBB。',
  ),
  MIN: wording((p) => `Must be >= ${p.minimum}`, '提高数值。'),
  MAX: wording((p) => `Must be <= ${p.maximum}`, '降低数值。'),
  ARRAY_SIZE: wording((p) => `Expected at least ${p.minItems} item(s)`, '增加必填数组项。'),
  REQUIRED: wording((p) => `Missing required property ${p.property}`, '补全必填字段。'),
  UNKNOWN_FIELD: wording((p) => `Unknown property ${p.property}`, '移到允许的 extra 对象或删除。'),
} as const satisfies Record<string, DiagnosticWording>;

/** Literature: references, time and storyboard (`semantic`). Messages are English, fixes Chinese. */
export const SEMANTIC_WORDING = {
  DUPLICATE_ID: wording((p) => `Duplicate id: ${p.id}`, '使用未占用的稳定 id。'),
  TIME_RANGE: wording((p) => `Time point ${p.value} outside [1, ${p.limit}]`, '调整为有效时点。'),
  UNKNOWN_FACTION: wording(
    (p) => `Unknown faction ${p.faction}`,
    '在 factions 中添加阵营或修改引用。',
  ),
  BIO_LENGTH: wording('Biography summary exceeds 120 characters', '缩短摘要。'),
  UNKNOWN_SOURCE: wording((p) => `Unknown source ${p.ref}`, '改为已有的人物 id。'),
  UNKNOWN_TARGET: wording((p) => `Unknown target ${p.ref}`, '改为已有的人物 id。'),
  SELF_LOOP: wording('Self-loop forbidden', '改写到人物小传。'),
  OTHER_LABEL: wording('other requires a label', '提供关系短标签。'),
  DUPLICATE_RELATION: wording(
    (p) => `Duplicate of ${p.relation}`,
    '合并相同人物对、type、label 的关系。',
  ),
  INVERTED_INTERVAL: wording('chapters.from exceeds chapters.to', '修正生效区间。'),
  DURATION: wording('durationSec must be positive', '设置正数秒数。'),
  TRANSITION: wording('transitionMs must not be negative', '改为非负毫秒数。'),
  CAMERA_CONFLICT: wording('focusNodeId and fitIds are mutually exclusive', '选择一种镜头目标。'),
  UNKNOWN_REF: wording((p) => `Unknown ${p.kind}: ${p.ref}`, '替换为对应集合中的有效 id。'),
  TOO_MANY_LEADS: wording('More than two importance 5 characters', '建议最多两个绝对主角。'),
  TOO_MANY_STRONG: wording('More than 15% of edges have strength 5', '只保留最核心的关系。'),
  ORPHAN: wording('Unconnected character', '核实关系或标为仅提及。'),
  UNTIMED_EDGES: wording(
    'Timeline scenes exist but no relation has chapters',
    '为随时间变化的关系添加章节区间。',
  ),
  MISSING_POSITIONS: wording(
    'More than half of characters lack positions',
    '给关键人物预置坐标，避免开场布局跳动。',
  ),
} as const satisfies Record<string, DiagnosticWording>;

/** Generic graphs: the `relgraph.graph/1` parser and adapter (`graph-source`). */
export const GENERIC_WORDING = {
  STRUCTURE: wording('不是通用关系图文档。', (p) => `使用 format: "${p.format}"。`),
  'TOO_LARGE.limits': wording(
    (p) => `图谱过大（上限 ${p.nodes} 个节点、${p.edges} 条关系）。`,
    '先筛选或聚合数据，再制作影片。',
  ),
  'TOO_LARGE.nodes': wording('节点数量超过上限。', '先筛选或聚合数据，再制作影片。'),
  EMPTY: wording('图谱中没有任何节点或关系。', '至少添加一个节点或一条关系。'),
  LARGE_GRAPH: wording(
    (p) =>
      `图谱较大（${p.nodes} 个节点、${p.edges} 条关系），超出流畅预览的范围（约 ${p.previewNodes} 个节点、${p.previewEdges} 条关系）。`,
    '预览可能卡顿，导出的影片不受影响；如需流畅预览，请先筛选或聚合数据。',
  ),
  'TYPE.array': wording((p) => `${p.field} 必须是数组。`, '改为数组，或删除该字段。'),
  BEAT: wording('镜头节拍无效。', '按时间递增排列镜头内的节拍，并检查对象引用和字段值。'),
  'TYPE.ids': wording((p) => `${p.field} 必须是数组。`, '改为 id 数组。'),
  'TYPE.object': wording(
    (p) => `${p.field} 必须是对象。`,
    (p) => `使用 ${p.shape}。`,
  ),
  'TYPE.boolean': wording((p) => `${p.field} 必须是布尔值。`, '使用 true 或 false。'),
  'TYPE.number': wording('需要有限数值。', '改为数字，或删除该字段。'),
  'TYPE.text': wording('文本字段无效。', (p) => `使用不超过 ${p.limit} 个字符的文本。`),
  'TYPE.edge': wording('关系必须是对象。', '使用 { "source": …, "target": … }。'),
  'TYPE.kindTable': wording('类别表必须是对象。', '以类别名为键。'),
  'TYPE.timeline': wording('timeline 无效。', '使用 { "unit": "步骤" }。'),
  'TYPE.shot': wording('分镜必须是对象。', '使用 { "title": …, "durationSec": … }。'),
  'ID.node': wording('节点缺少有效 id。', '提供非空文本或数字 id。'),
  'ID.group': wording('分组缺少有效 id。', '提供非空文本或数字 id。'),
  'DUPLICATE_ID.node': wording('节点 id 重复。', '每个节点使用唯一 id。'),
  'DUPLICATE_ID.group': wording('分组 id 重复。', '每个分组使用唯一 id。'),
  'DUPLICATE_ID.relation': wording('关系 id 重复。', '每条关系使用唯一 id，或省略 id。'),
  'DUPLICATE_ID.shot': wording('分镜 id 重复。', '每个分镜使用唯一 id，或省略 id。'),
  EDGE_REF: wording((p) => `关系缺少 ${p.end}。`, '填写节点 id。'),
  GROUP_REF: wording('分组引用无效。', '填写分组 id，或删除该字段。'),
  SCENE_REF: wording('引用了不存在的对象。', '使用已有 id。'),
  'KIND.name': wording('类别名无效。', (p) => `使用不超过 ${p.limit} 个字符的非空文本。`),
  'KIND.declaration': wording('类别声明无效。', '使用 { "label": …, "color": … } 对象。'),
  'ENUM.shape': wording('形状无效。', (p) => zhList(p.allowed)),
  'ENUM.line': wording('线型无效。', (p) => zhList(p.allowed)),
  'ENUM.head': wording('端点无效。', (p) => zhList(p.allowed)),
  'ENUM.diagram': wording('图的类型无效。', (p) => zhList(p.allowed)),
  COLOR: wording('颜色无效。', '使用 #RRGGBB 六位十六进制颜色。'),
  WEIGHT: wording('权重不能为负。', '使用非负数。'),
  'INTERVAL.visible': wording('可见区间无效。', '确保 visibleFrom 不大于 visibleTo。'),
  'INTERVAL.visibleTo': wording(
    '可见区间无效。',
    '确保 start 不大于 visibleTo，或用 visibleFrom 指定首次出现的时间。',
  ),
  'INTERVAL.end': wording('end 需要同时提供 start。', '补充 start，或删除 end。'),
  'INTERVAL.span': wording('时间跨度无效。', '确保 start 不大于 end。'),
  POSITION: wording('坐标无效。', '使用 { "x": 数字, "y": 数字 }。'),
  LANE_ONLY: wording(
    '坐标只有 y，无法由日期得出 x；布局将重新摆放此节点，原有 y 不会保留。',
    '只有在保持时间轴、且至少有两个不同时间的时间线上，带日期节点才能只写 y；否则补充 x，使用 { "x": 数字, "y": 数字 }。',
  ),
  OFF_TIME_AXIS: wording(
    (p) => `${p.count} 个带日期的节点横坐标不在其时间上，已按日期绘制。`,
    '带日期节点的横坐标由日期决定：删除其 x，只保留 y（重新导出带坐标的数据会这样写）；如需保留这些横坐标并不显示时间轴，请设置 "timeAxis": false。',
  ),
  IMPLICIT_NODES: wording(
    (p) => `${p.count} 个节点只在关系中出现，已按 id 自动创建。`,
    '如需名称、类别或分组，请在 nodes 中声明它们。',
  ),
  DURATION: wording('时长无效。', '使用 0 到 600 之间的秒数。'),
  CAMERA_ZOOM: wording('镜头缩放无效。', '使用大于 0 的数值，或删除 zoom。'),
  TRANSITION: wording('转场时长无效。', '使用不小于 0 的毫秒数。'),
  CAMERA_CONFLICT: wording('镜头目标冲突。', 'focusNodeId 与 fitIds 只保留一个。'),
  'EVIDENCE.type': wording('evidence 必须是数组。', '改为证据条目数组，或删除该字段。'),
  'EVIDENCE.item': wording(
    (p) =>
      `证据条目无效：需要非空文本（出处），或含非空 cite 的对象；文本不超过 ${p.limit} 个字符。`,
    '写成 "王维《送孟六归襄阳》"，或 { "cite": …, "quote": …, "url": …, "locator": … }；quote 必须是原文。',
  ),
  'SCENE_EVIDENCE.target': wording(
    '证据卡片需要且只能指定 nodeId 或 edgeId 之一。',
    '使用 { "edgeId": … } 或 { "nodeId": … }，可加 items。',
  ),
  'SCENE_EVIDENCE.empty': wording(
    '证据卡片引用的对象没有证据。',
    '为该对象添加 evidence，或删除卡片。',
  ),
  'SCENE_EVIDENCE.items': wording(
    (p) => `items 需要互不重复的证据序号（0 到 ${p.last}）。`,
    '列出要显示的证据条目序号，或删除 items 以显示全部。',
  ),
  'SCENE_EVIDENCE.card': wording(
    '同一分镜不能同时打开详情卡片和证据卡片。',
    '删除 openDetailNodeId 或 evidence 之一。',
  ),
} as const satisfies Record<string, DiagnosticWording>;

/** The loader itself: formats, projects and playability (`studio`). */
export const LOAD_WORDING = {
  JSON: wording((p) => `JSON 语法错误：${p.detail}`, '检查引号、逗号和括号后重试。'),
  FORMAT: wording(
    '无法识别数据格式。',
    '通用关系图使用 format: "relgraph.graph/1"；文学数据需要 schemaVersion: "0.1"；社会网络使用 format: "relgraph.social/0.1-draft"；生物学数据需要 format: "relgraph.bio/0.1-draft"。',
  ),
  'PROJECT_CONFIG.field': wording('项目配置无效。', '修正该配置字段或移除覆盖。'),
  'PROJECT_CONFIG.reference': wording('项目配置无效。', '检查对象引用与样式范围。'),
  NO_SCENES: wording('没有可播放的分镜。', '请在 presentation 中至少添加一个分镜。'),
  INITIAL_DOMAIN_TIME: wording(
    '数据包含时间范围，但首个分镜没有指定领域时间。',
    (p) => `为首个分镜设置 ${p.field}，以避免提前显示未来对象。`,
  ),
  INVALID_DATA: wording('数据无法转换为图谱。', '检查文件格式、字段类型和必填字段后重试。'),
  EVIDENCE_CARD_HIDDEN: wording(
    (p) =>
      `证据卡片要等镜头移动结束、对象揭示过半（约第 ${p.shown} 秒）才出现，但分镜在第 ${p.end} 秒就结束了，卡片不会显示。`,
    '延长 durationSec，或缩短 transitionMs。',
  ),
  CAPTION_READING_SPEED: wording(
    (p) => `分镜标题和旁白约需 ${p.needed} 秒读完，完整显示只有 ${p.shown} 秒。`,
    (p) => `把 durationSec 延长到至少 ${p.suggested} 秒，或缩短标题和旁白。`,
  ),
} as const satisfies Record<string, DiagnosticWording>;

export const SOCIAL_WORDING = {
  SOCIAL_MARK: wording('人物标注需要布尔值。', '使用 true 或 false。'),
  SOCIAL_INCIDENT: wording('此人物标注与关系端点冲突。', '核对关系或人物标注。'),
  SOCIAL_PAIR: wording('排除组合无效。', '提供唯一标识、两个不同人物、理由和证据。'),
  SOCIAL_FORMAT: wording('无法识别社会网络格式。', '使用 relgraph.social/0.1-draft。'),
  SOCIAL_CO_PRESENCE: wording('assertsCoPresence 需要布尔值。', '使用 true 或 false。'),
  SOCIAL_BASIS: wording('无法识别关系依据。', '使用 attested 或 inferred。'),
  INFERRED_SOLID: wording('实线会让推定关系看起来像有据关系。', '将线型设为 dashed 或 dotted。'),
} as const satisfies Record<string, DiagnosticWording>;

/** Every worded layer and its table. */
export const DIAGNOSTIC_WORDING = {
  structure: STRUCTURE_WORDING,
  semantic: SEMANTIC_WORDING,
  'graph-source': GENERIC_WORDING,
  'social-source': SOCIAL_WORDING,
  studio: LOAD_WORDING,
} as const;
export type WordedLayer = keyof typeof DIAGNOSTIC_WORDING;
/** The same keys, worded in another language. */
export type DiagnosticCatalogue = {
  readonly [L in WordedLayer]: Readonly<
    Record<keyof (typeof DIAGNOSTIC_WORDING)[L], DiagnosticWording>
  >;
};

/** A diagnostic's wording key: its code, and its variant if it has one. */
export const diagnosticKey = (entry: { code: string; variant?: string }): string =>
  entry.variant ? `${entry.code}.${entry.variant}` : entry.code;

/** The code, variant, parameters and text of a diagnostic, from its key. */
export function worded<K extends string>(
  table: Readonly<Record<K, DiagnosticWording>>,
  key: K,
  params?: DiagnosticParams,
): { code: string; variant?: string; params?: DiagnosticParams; message: string; fix: string } {
  const dot = key.indexOf('.'),
    values = params ?? {};
  return {
    code: dot < 0 ? key : key.slice(0, dot),
    ...(dot < 0 ? {} : { variant: key.slice(dot + 1) }),
    ...(params ? { params } : {}),
    message: table[key].message(values),
    fix: table[key].fix(values),
  };
}
