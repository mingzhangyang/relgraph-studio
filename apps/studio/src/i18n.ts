/**
 * Workspace-only interface language. Never translate graph, project, transcript
 * source data, movie frames, or serialized documents.
 *
 * Chinese is the existing default. Language preference is independent from
 * project savepoints, and storage failures must not block the workspace.
 */
export type StudioLanguage = 'zh-CN' | 'en';
export const STUDIO_LANGUAGE_KEY = 'relgraph-studio-language';

const english: Record<string, string> = {
  导演工作台: 'Director workspace',
  'RelGraph Studio · 导演工作台': 'RelGraph Studio · Director Workspace',
  '关系叙事 · 导演工作台': 'Relationship stories · Director studio',
  '本地运行 · 不上传数据': 'Runs locally · No data uploaded',
  'B1 · 逐帧预览': 'B1 · Frame-by-frame preview',
  '切换浅色 / 深色模式': 'Toggle light / dark theme',
  主题: 'Theme',
  浅色: 'Light',
  深色: 'Dark',
  切换到深色模式: 'Switch to dark mode',
  切换到浅色模式: 'Switch to light mode',
  界面语言: 'Interface language',
  导演预览: 'Director preview',
  '正在加载…': 'Loading…',
  就绪: 'Ready',
  播放中: 'Playing',
  数据校验失败: 'Validation failed',
  '数据校验失败 · 请查看右侧校验提示': 'Validation failed · See diagnostics on the right',
  '请选择示例或导入有效的 JSON 数据': 'Choose an example or import valid JSON data',
  文档操作: 'Document actions',
  撤销: 'Undo',
  '撤销 ·': 'Undo ·',
  保存: 'Save',
  重做: 'Redo',
  '撤销 · Ctrl/⌘+Z': 'Undo · Ctrl/⌘+Z',
  '重做 · Ctrl+Y / Ctrl/⌘+Shift+Z': 'Redo · Ctrl+Y / Ctrl/⌘+Shift+Z',
  保存完整项目: 'Save full project',
  '保存完整 .studio.json（Ctrl/⌘+S）': 'Save full .studio.json (Ctrl/⌘+S)',
  '仅导出坐标 JSON': 'Export coordinates JSON',
  '仅导出源数据的节点坐标，不保存画面属性':
    'Export only source node coordinates, not visual settings',
  无未保存修改: 'All changes saved',
  未保存修改: 'Unsaved changes',
  '完整项目包含外观、文案及坐标；坐标导出不保存样式。':
    'Full projects include appearance, captions, and coordinates; coordinate exports omit styling.',
  关系叙事视频预览: 'Relationship story video preview',
  '当前分镜和关系见画面文字说明。':
    'See the scene transcript for the current shot and relationships.',
  '请选择数据后，可在画面上查看选中对象和影响范围。':
    'Select data to view the chosen object and affected area on the canvas.',
  节点位置微调: 'Node positioning',
  调整节点位置: 'Adjust node positions',
  重置调整: 'Reset adjustments',
  '调整模式关闭 · 保存完整项目请使用上方工具栏':
    'Position editing off · Use the toolbar above to save the full project',
  键盘坐标调整: 'Keyboard coordinate editing',
  当前可见节点: 'Currently visible nodes',
  选择可见节点: 'Select a visible node',
  'X 坐标': 'X coordinate',
  'Y 坐标': 'Y coordinate',
  应用坐标: 'Apply coordinates',
  '拖动当前可见节点 · ': 'Drag visible nodes · ',
  '时间轴 · 拖动可换泳道，横坐标由日期决定 · ':
    'Timeline · Drag to change lane; X is set by the dates · ',
  '时间轴：横坐标由日期决定': 'Timeline: X is set by the dates',
  有坐标调整: 'Coordinates changed',
  尚未调整: 'No adjustments yet',
  ' · 通过文档工具栏导出保存': ' · Export from the document toolbar',
  '已有坐标调整 · 可保存完整项目或单独导出坐标':
    'Coordinates changed · Save the full project or export coordinates',
  播放控制: 'Playback controls',
  播放: 'Play',
  暂停: 'Pause',
  重开: 'Restart',
  视频时间轴: 'Video timeline',
  '播放 / 暂停': 'Play / pause',
  '撤销 · 保存': 'Undo · Save',
  '前后 1 秒': 'Back / forward 1 second',
  '播放器显示视频时间；章节 / 阶段为领域时间，二者独立计算。':
    'The player shows video time; chapters and stages use a separate domain timeline.',
  分镜时间轴: 'Shot timeline',
  '未播放到的分镜标题会被隐藏，防止剧透': 'Upcoming shot titles are hidden to prevent spoilers',
  分镜列表: 'Shot list',
  当前画面文字说明: 'Current frame transcript',
  数据与校验信息: 'Data and diagnostics',
  数据来源: 'Data source',
  示例数据: 'Example data',
  红楼梦: 'Dream of the Red Chamber',
  '文学 · 演示数据': 'Literature · Demo data',
  生物信号: 'Biological signaling',
  'EGFR–MAPK · 经典通路': 'EGFR–MAPK · Canonical pathway',
  线上书店: 'Online bookshop',
  进化树: 'Evolutionary tree',
  '树 · 逐层展开': 'Tree · Unfolds by level',
  朝代更替: 'Dynasties',
  '时间轴 · 沿时间演进': 'Timeline · Travels through time',
  读书会: 'Reading club',
  思维导图: 'Mind map',
  订单流程: 'Order handling',
  流程图: 'Flowchart',
  '通用关系 · 合成数据 · 布局与分镜自动生成':
    'Any relations · Synthetic data · Layout and shots derived',
  '导入本地 JSON': 'Import local JSON',
  '点击选择，或将文件拖到此处': 'Choose a file or drag and drop it here',
  当前: 'Current',
  尚未加载: 'Not loaded',
  '布局策略 · 预览后应用': 'Layout strategy · Preview before applying',
  布局策略: 'Layout strategy',
  画面属性: 'Visual properties',
  当前分镜: 'Current shot',
  '领域时间：—': 'Domain time: —',
  '领域时间：未指定': 'Domain time: unspecified',
  '领域时间：': 'Domain time: ',
  时点: 'point',
  可见节点: 'Visible nodes',
  可见关系: 'Visible relationships',
  分镜: 'Shots',
  数据说明: 'About the data',
  校验提示: 'Diagnostics',
  '此数据未提供来源说明。': 'No source note was provided for this data.',
  '未发现校验问题。': 'No validation issues found.',
  错误: 'Errors',
  警告: 'Warnings',
  '建议：': 'Suggestion: ',
  数据无效: 'Invalid data',
  提示: 'Notice',
  '检查数据并重试。': 'Check the data and try again.',
  当前人物简介: 'Current character profile',
  当前可见关系: 'Currently visible relationships',
  '没有已加载的有效数据。': 'No valid data is loaded.',
  '跳转至分镜 ': 'Jump to shot ',
  '分镜 ': 'Shot ',
  '，分镜 ': ', shot ',
  '布局 · 预览后应用': 'Layout · Preview before applying',
  策略: 'Strategy',
  '手动 · 保留微调': 'Manual · Keep adjustments',
  '自动 · 按结构选择': 'Auto · Chosen from structure',
  '力导向 · 聚类': 'Force-directed · Clustered',
  '分层 · 自上而下': 'Layered · Top to bottom',
  '流向 · 从左到右': 'Flow · Left to right',
  '树 · 向右展开': 'Tree · Grows to the right',
  '思维导图 · 向两侧展开': 'Mind map · Both sides',
  '时间轴 · 按时间排开': 'Timeline · Placed in time',
  '放射 · 以核心为圆心': 'Radial · Around the centre',
  环形: 'Ring',
  '网格 · 保持顺序': 'Grid · Keeps your order',
  坐标策略: 'Coordinate policy',
  保留现有坐标: 'Preserve coordinates',
  只填补缺失坐标: 'Fill missing coordinates',
  重排未锁定节点: 'Rearrange unlocked nodes',
  间距: 'Spacing',
  力导向迭代次数: 'Force iterations',
  '当前可见节点 · 锁定': 'Visible nodes · Lock',
  锁定选中节点的当前坐标: 'Lock selected node coordinates',
  '布局在播放前计算。分层与流向表示连接结构，不推断家谱世代。':
    'Layout is computed before playback. Layers and flow describe connections, not generations.',
  预览布局: 'Preview layout',
  应用布局: 'Apply layout',
  取消预览: 'Cancel preview',
  '参数不能为空。': 'Parameters cannot be empty.',
  '手动策略保留现有坐标：没有可预览的变化。':
    'Manual keeps the current coordinates: there is nothing to preview.',
  '“保留现有坐标”不会移动任何节点：请改选“重排未锁定节点”或“只填补缺失坐标”。':
    '“Preserve coordinates” moves no node: choose “Rearrange unlocked nodes” or “Fill missing coordinates”.',
  '此布局与当前画面相同：没有可应用的变化。':
    'This layout matches the current picture: there is nothing to apply.',
  '实际绘制：': 'Drawn with: ',
  '时间轴会横向移动已锁定的节点：': 'The time axis would move locked nodes sideways: ',
  '。请先解锁它们，或改选其他布局。': '. Unlock them first, or choose another layout.',
  '。请先解锁它们，再重置。': '. Unlock them first, then reset.',
  '预览可能卡顿，导出的影片不受影响；如需流畅预览，请先筛选或聚合数据。':
    'The preview may stutter; exported films are not affected. For a smooth preview, filter or aggregate the data first.',
  '带日期节点的横坐标由日期决定：删除其 x，只保留 y（重新导出带坐标的数据会这样写）；如需保留这些横坐标并不显示时间轴，请设置 "timeAxis": false。':
    'A dated node\'s x is set by its date: remove the x and keep only y (re-exporting the positioned data writes it that way). To keep these x coordinates and draw no time axis, set "timeAxis": false.',
  '（保留现有坐标）': ' (existing coordinates kept)',
  '（按图的类型）': ' (follows the diagram kind)',
  '（按图的结构）': ' (chosen from the graph structure)',
  '（节点过多，改用网格）': ' (too many nodes; grid instead)',
  '（没有节点带日期，时间轴退回为树）':
    ' (no node has a date, so the timeline falls back to a tree)',
  '临时预览 · 尚未保存。请应用或取消；可撤销已应用布局。':
    'Temporary preview · Not saved. Apply or cancel; applied layouts can be undone.',
  '静态确定性布局 · 保留 = 不移动；填补 = 仅缺失；重排 = 移动未锁定节点。自动 = 按图的结构选择策略。':
    'Deterministic static layout · Preserve = no movement; Fill = missing only; Rearrange = unlocked nodes. Auto = strategy chosen from the graph structure.',
  画面与属性: 'Appearance and properties',
  '选择画面对象或使用列表。空值继承；↺ 清除覆盖。':
    'Select an object on the canvas or in the list. Empty values inherit; ↺ clears overrides.',
  形状: 'Shape',
  '半径 · px': 'Radius · px',
  填充色: 'Fill color',
  边框色: 'Border color',
  边框宽度: 'Border width',
  字号: 'Font size',
  字重: 'Font weight',
  文字色: 'Text color',
  文字位置: 'Text position',
  线条颜色: 'Line color',
  线宽: 'Line width',
  虚实: 'Line style',
  端点: 'Arrowhead',
  '曲率 · 0 为直线': 'Curvature · 0 = straight',
  显示标签: 'Show label',
  标签字号: 'Label font size',
  标签字重: 'Label font weight',
  标签文字色: 'Label text color',
  端点未显示: 'Endpoints not visible',
  协调预设: 'Appearance preset',
  '编辑 · 默认': 'Editorial · Default',
  '安静 · 细线': 'Quiet · Thin lines',
  '演示 · 醒目': 'Presentation · Bold',
  对象类型: 'Object type',
  节点: 'Node',
  连线: 'Edge',
  当前安全可见对象: 'Currently visible objects',
  样式作用范围: 'Style scope',
  单个对象: 'Single object',
  当前类别: 'Current category',
  全局默认: 'Global defaults',
  '显示文案 · 未自动核实。原始姓名、关系事实与来源证据保存在源数据中。':
    'Display copy · Not automatically verified. Original names, relationships, and evidence stay in source data.',
  '显示名称 / 关系标签': 'Display name / Relationship label',
  显示说明: 'Display description',
  '节点图片 · 仅当前节点': 'Node image · Selected node only',
  '填满 · 居中裁切': 'Cover · Center crop',
  '完整显示 · 保留留白': 'Contain · Keep margins',
  图片适配: 'Image fit',
  移除图片: 'Remove image',
  恢复继承图片: 'Restore inherited image',
  恢复原文: 'Restore original text',
  '高级样式 · 继承与覆盖': 'Advanced styles · Inheritance and overrides',
  '#RRGGBB · 留空继承': '#RRGGBB · Empty = inherit',
  留空继承: 'Empty = inherit',
  继承: 'Inherit',
  选择: 'Choose ',
  '恢复继承：': 'Restore inherited value: ',
  恢复继承: 'Restore inherited value',
  '配置无效：': 'Invalid configuration: ',
  '此值未能应用，请检查项目错误提示。': 'Could not apply this value. Check project errors.',
  '恢复继承失败，请检查项目错误提示。': 'Could not restore inheritance. Check project errors.',
  '— 请选择 —': '— Select —',
  '类别：': 'Category: ',
  有向: 'Directed',
  无向: 'Undirected',
  ' · 关系事实保持原样': ' · Relationship facts unchanged',
  '全局样式可作用于未来对象，列表只显示当前投影。':
    'Global styles may affect future objects; the list shows only the current projection.',
  '正在本地处理图片…': 'Processing image locally…',
  '已设置图片 · ': 'Image set · ',
  'PNG / JPEG / WebP · 最长边保存为 256 像素 · 不上传服务器':
    'PNG / JPEG / WebP · Longest side saved at 256 pixels · No upload',
  对象: 'Object',
  类别: 'Category',
  全局: 'Global',
  默认: 'Default',
  清除当前范围样式: 'Clear styles for this scope',
  恢复默认画面: 'Restore default appearance',
  '有效范围：': 'Valid range: ',
  '；留空继承': '; empty = inherit',
  '颜色格式：#RRGGBB；留空继承': 'Color format: #RRGGBB; empty = inherit',
  通过图片上传控件设置: 'Set using image upload',
  '不支持的样式字段。': 'Unsupported style field.',
  '数字输入尚未完成，请修正后再应用。': 'Finish the number before applying.',
  '请输入 ': 'Enter a number in the ',
  ' 范围内的数字。': ' range.',
  '数值必须在 ': 'Value must be between ',
  ' 之间。': '.',
  '请输入六位十六进制颜色，如 #336699。': 'Enter a six-digit hex color such as #336699.',
  '请选择有效选项。': 'Select a valid option.',
  '图片引用无效。': 'Invalid image reference.',
  '当前项目有未保存的修改。继续加载其他数据将丢弃这些修改，是否继续？':
    'The current project has unsaved changes. Loading other data will discard them. Continue?',
  '仍有未提交的输入、拖动或图片处理，请完成后再保存项目。':
    'Finish pending inputs, dragging, or image processing before saving.',
  '图片配置超出容量或包含无效字段：': 'Image settings exceed limits or contain invalid fields: ',
  '保存失败：': 'Save failed: ',
  '已发起完整项目 JSON 下载，请确认浏览器已将文件保存到本机。':
    'Full project JSON download started. Confirm the file was saved on your device.',
  // Image upload errors originate in the DOM-free image preflight and decoder.
  '请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。':
    'Choose a PNG, JPEG, or WebP image no larger than 8 MB.',
  '图片无法解码，请更换文件。': 'This image could not be decoded. Choose another file.',
  '图片尺寸过大，请先缩小到 1600 万像素以内。':
    'Image dimensions are too large. Reduce the image to 16 million pixels or fewer.',
  '无法准备图片画布。': 'Unable to prepare a canvas for this image.',
  '图片格式或尺寸信息无效或不完整，请更换 PNG、JPEG 或 WebP 文件。':
    'Invalid or incomplete image format or dimensions. Choose another PNG, JPEG, or WebP file.',
  '仅支持 PNG、JPEG、WebP 静态图片。': 'Only static PNG, JPEG, and WebP images are supported.',
  '当前没有可保存的完整项目，请先加载有效数据。':
    'No complete project is available to save. Load valid data first.',
  '坐标必须是有限数字，请检查 X 和 Y': 'Coordinates must be finite numbers. Check X and Y.',
  '导出的 JSON 没有通过数据校验': 'Exported JSON failed validation',
  '已准备导出：': 'Export prepared: ',
  '。此文件仅保存源数据坐标，不代表完整项目已保存。':
    '. This file only saves source coordinates; the full project is not saved.',
  '导出失败：': 'Export failed: ',
  无法读取示例: 'Cannot load example',
  无法读取文件: 'Cannot read file',
  '从仓库根目录运行 npm run dev 或 npm run preview 后重新打开工作台。':
    'Run npm run dev or npm run preview from the repository root, then reopen the workspace.',
  '请选择可读取的 JSON 文件。': 'Select a readable JSON file.',
  '红楼梦 · 未经原著核实的技术演示': 'Dream of the Red Chamber · Unverified technical demo',
  '生物信号 · EGFR–MAPK 经典通路': 'Biological signaling · EGFR–MAPK canonical pathway',
  '线上书店 · 通用关系合成示例': 'Online bookshop · Synthetic generic-graph example',
  '进化树 · 逐层展开的简化示例': 'Evolutionary tree · Simplified, unfolding by level',
  '朝代更替 · 时间轴简化示例': 'Dynasties · Simplified timeline',
  '读书会 · 思维导图合成示例': 'Reading club · Synthetic mind map',
  '订单流程 · 流程图合成示例': 'Order handling · Synthetic flowchart',
  节点位置调整: 'Node position adjustment',
  '当前投影 ': 'Current projection: ',
  ' 个，已描边 ': ' objects; outlined: ',
  ' 个': ' objects',
  请选择一个: 'Select an ',
  '，查看其': ' to view its ',
  位置: 'position',
  '。': '.',
  已选中: 'Selected ',
  画面已描边: 'outlined on canvas',
  尚未绘制到当前画面: 'not drawn in this frame',
  ' 个节点，': ' nodes, ',
  ' 条关系。': ' relationships. ',
  ' 当前 ': ' Currently: ',
  '修复 Schema。': 'Fix the schema.',
  '更新 Schema 校验器。': 'Update the schema validator.',
  '修正字段类型。': 'Correct the field type.',
  '请使用 0.1 数据，或升级播放器。': 'Use version 0.1 data or upgrade the player.',
  '使用规范中的枚举值。': 'Use an allowed enum value.',
  'id 使用小写 ASCII、数字与连字符；颜色使用 #RRGGBB。':
    'Use lowercase ASCII, digits, and hyphens for IDs; use #RRGGBB colors.',
  '提高数值。': 'Increase the value.',
  '降低数值。': 'Decrease the value.',
  '增加必填数组项。': 'Add the required array items.',
  '补全必填字段。': 'Add the required fields.',
  '移到允许的 extra 对象或删除。': 'Move it to an allowed extra object or remove it.',
  '使用未占用的稳定 id。': 'Use an unused stable ID.',
  '调整为有效时点。': 'Use a valid time point.',
  '在 factions 中添加阵营或修改引用。': 'Add the faction to factions or fix the reference.',
  '缩短摘要。': 'Shorten the summary.',
  '改为已有的人物 id。': 'Reference an existing character ID.',
  '改写到人物小传。': 'Move it to the character biography.',
  '提供关系短标签。': 'Provide a short relationship label.',
  '合并相同人物对、type、label 的关系。':
    'Merge duplicate relations with matching characters, type, and label.',
  '修正生效区间。': 'Correct the effective interval.',
  '设置正数秒数。': 'Set a positive duration in seconds.',
  '改为非负毫秒数。': 'Use a nonnegative number of milliseconds.',
  '选择一种镜头目标。': 'Choose one camera target.',
  '替换为对应集合中的有效 id。': 'Use a valid ID from the corresponding collection.',
  '建议最多两个绝对主角。': 'Prefer at most two central protagonists.',
  '只保留最核心的关系。': 'Keep only the most important relationships.',
  '核实关系或标为仅提及。': 'Verify the relationship or mark the character as mentioned only.',
  '为随时间变化的关系添加章节区间。': 'Add chapter ranges to time-dependent relations.',
  '给关键人物预置坐标，避免开场布局跳动。':
    'Set initial positions for key characters to prevent opening layout jumps.',
  '项目配置无效。': 'Invalid project configuration.',
  '修正该配置字段或移除覆盖。': 'Correct the field or remove the override.',
  '检查对象引用与样式范围。': 'Check object references and style scope.',
  '无法识别数据格式。': 'Unrecognized data format.',
  '通用关系图使用 format: "relgraph.graph/1"；文学数据需要 schemaVersion: "0.1"；生物学数据需要 format: "relgraph.bio/0.1-draft"。':
    'Generic graphs use format: "relgraph.graph/1"; literature requires schemaVersion: "0.1"; biology requires format: "relgraph.bio/0.1-draft".',
  '图谱中没有任何节点或关系。': 'The graph has no nodes or relations.',
  '至少添加一个节点或一条关系。': 'Add at least one node or relation.',
  '不是通用关系图文档。': 'Not a generic graph document.',
  '节点 id 重复。': 'Duplicate node id.',
  '每个节点使用唯一 id。': 'Give every node a unique id.',
  '引用了不存在的对象。': 'References an object that does not exist.',
  '使用已有 id。': 'Use an existing id.',
  '颜色无效。': 'Invalid colour.',
  '可见区间无效。': 'Invalid visibility interval.',
  '确保 start 不大于 visibleTo，或用 visibleFrom 指定首次出现的时间。':
    'Keep start at or before visibleTo, or set visibleFrom to say when it first appears.',
  '分镜 id 重复。': 'Duplicate shot id.',
  '每个分镜使用唯一 id，或省略 id。': 'Give every shot a unique id, or leave the id out.',
  '镜头缩放无效。': 'Invalid camera zoom.',
  '使用大于 0 的数值，或删除 zoom。': 'Use a number greater than 0, or remove zoom.',
  '转场时长无效。': 'Invalid transition duration.',
  '使用不小于 0 的毫秒数。': 'Use zero or more milliseconds.',
  '镜头目标冲突。': 'Conflicting camera targets.',
  'focusNodeId 与 fitIds 只保留一个。': 'Keep either focusNodeId or fitIds, not both.',
  '使用 format: "relgraph.graph/1"。': 'Use format: "relgraph.graph/1".',
  '改为数组，或删除该字段。': 'Change it to an array, or remove the field.',
  '文本字段无效。': 'Invalid text field.',
  '需要有限数值。': 'A finite number is required.',
  '改为数字，或删除该字段。': 'Change it to a number, or remove the field.',
  '确保 visibleFrom 不大于 visibleTo。': 'Keep visibleFrom at or before visibleTo.',
  '类别名无效。': 'Invalid kind name.',
  '先筛选或聚合数据，再制作影片。': 'Filter or aggregate the data before making a film.',
  '节点缺少有效 id。': 'Node has no valid id.',
  '提供非空文本或数字 id。': 'Provide a non-empty text or numeric id.',
  '关系必须是对象。': 'A relation must be an object.',
  '使用 { "source": …, "target": … }。': 'Use { "source": …, "target": … }.',
  '填写节点 id。': 'Enter a node id.',
  '分组缺少有效 id。': 'Group has no valid id.',
  '分组 id 重复。': 'Duplicate group id.',
  '每个分组使用唯一 id。': 'Give every group a unique id.',
  '节点数量超过上限。': 'Too many nodes.',
  '使用 { nodes, edges }。': 'Use { nodes, edges }.',
  '类别表必须是对象。': 'A kind table must be an object.',
  '以类别名为键。': 'Key it by kind name.',
  '类别声明无效。': 'Invalid kind declaration.',
  '使用 { "label": …, "color": … } 对象。': 'Use a { "label": …, "color": … } object.',
  '形状无效。': 'Invalid shape.',
  '线型无效。': 'Invalid line style.',
  '端点无效。': 'Invalid line end.',
  '使用 true 或 false。': 'Use true or false.',
  '分组引用无效。': 'Invalid group reference.',
  '填写分组 id，或删除该字段。': 'Enter a group id, or remove the field.',
  '坐标无效。': 'Invalid coordinates.',
  '使用 { "x": 数字, "y": 数字 }。': 'Use { "x": number, "y": number }.',
  '只有在保持时间轴、且至少有两个不同时间的时间线上，带日期节点才能只写 y；否则补充 x，使用 { "x": 数字, "y": 数字 }。':
    'Only a dated node on a timeline that keeps time, with at least two distinct times, may give y alone; otherwise add x: use { "x": number, "y": number }.',
  '权重不能为负。': 'Weight cannot be negative.',
  '使用非负数。': 'Use a non-negative number.',
  'end 需要同时提供 start。': 'end requires start.',
  '补充 start，或删除 end。': 'Add start, or remove end.',
  '时间跨度无效。': 'Invalid time span.',
  '确保 start 不大于 end。': 'Keep start at or before end.',
  '关系 id 重复。': 'Duplicate relation id.',
  '每条关系使用唯一 id，或省略 id。': 'Give every relation a unique id, or leave the id out.',
  '使用 { "title": … }。': 'Use { "title": … }.',
  'timeline 无效。': 'Invalid timeline.',
  '使用 { "unit": "步骤" }。': 'Use { "unit": "step" }.',
  '分镜必须是对象。': 'A shot must be an object.',
  '使用 { "title": …, "durationSec": … }。': 'Use { "title": …, "durationSec": … }.',
  '改为 id 数组。': 'Change it to an array of ids.',
  '使用 { "fitIds": […] }。': 'Use { "fitIds": […] }.',
  '使用 { "nodeIds": […] }。': 'Use { "nodeIds": […] }.',
  '时长无效。': 'Invalid duration.',
  '使用 0 到 600 之间的秒数。': 'Use a number of seconds between 0 and 600.',
  '如需名称、类别或分组，请在 nodes 中声明它们。':
    'Declare them in nodes to give them a name, kind, or group.',
  '图的类型无效。': 'Invalid diagram kind.',
  '使用 #RRGGBB 六位十六进制颜色。': 'Use a six-digit #RRGGBB colour.',
  '没有可播放的分镜。': 'No playable shots found.',
  '请在 presentation 中至少添加一个分镜。': 'Add at least one shot to presentation.',
  '数据包含时间范围，但首个分镜没有指定领域时间。':
    'Data has a time range, but the first shot has no domain time.',
  '数据无法转换为图谱。': 'Could not convert data into a graph.',
  '检查文件格式、字段类型和必填字段后重试。': 'Check the format, field types, and required fields.',
  'JSON 语法错误：': 'JSON syntax error: ',
  '检查引号、逗号和括号后重试。': 'Check quotes, commas, and brackets.',
};
export function hasUiText(text: string): boolean {
  return Object.hasOwn(english, text);
}
let selectedLanguage: StudioLanguage = 'zh-CN';

export function initializeStudioLanguage(
  storage?: Pick<Storage, 'getItem'> | null,
): StudioLanguage {
  let choice: string | null | undefined;
  try {
    choice = storage?.getItem(STUDIO_LANGUAGE_KEY);
  } catch {
    // Storage is optional, including on restrictive or private browsers.
  }
  selectedLanguage = choice === 'en' ? 'en' : 'zh-CN';
  return selectedLanguage;
}
export function studioLanguage(): StudioLanguage {
  return selectedLanguage;
}
export function setStudioLanguage(
  language: StudioLanguage,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  selectedLanguage = language;
  try {
    storage?.setItem(STUDIO_LANGUAGE_KEY, language);
  } catch {
    // Keep the in-memory selection even if persistence is unavailable.
  }
}
export function uiText(chinese: string): string {
  return selectedLanguage === 'en' ? (english[chinese] ?? chinese) : chinese;
}

/** Translate only known workspace-generated status templates, never source text. */
export function uiMessage(message: string): string {
  if (selectedLanguage !== 'en') return message;
  const global = /^全局(节点|连线)样式 · 当前投影 (\d+) 个，已描边 (\d+) 个$/.exec(message);
  if (global)
    return `Global ${uiText(global[1]).toLowerCase()} styling · ${global[2]} visible, ${global[3]} outlined`;
  const choose = /^请选择一个(节点|连线)，查看其(类别|位置)。$/.exec(message);
  if (choose)
    return `Select a ${uiText(choose[1]).toLowerCase()} to view its ${uiText(choose[2]).toLowerCase()}.`;
  const category = /^当前类别 · 当前投影 (\d+) 个(节点|连线)，已描边 (\d+) 个$/.exec(message);
  if (category)
    return `Current category · ${category[1]} visible ${uiText(category[2]).toLowerCase()}s, ${category[3]} outlined`;
  const selected = /^已选中(节点|连线) · (画面已描边|尚未绘制到当前画面)$/.exec(message);
  if (selected) return `Selected ${uiText(selected[1]).toLowerCase()} · ${uiText(selected[2])}`;
  return uiText(message);
}

/** Diagnostic strings are produced by core in Chinese but displayed by the
 * workspace. Convert only known templates and leave identifiers untouched.
 */
export function uiDiagnostic(message: string): string {
  if (selectedLanguage !== 'en') return message;
  if (message.startsWith('建议：'))
    return uiText('建议：') + uiDiagnostic(message.slice('建议：'.length));
  if (message.startsWith('JSON 语法错误：'))
    return uiText('JSON 语法错误：') + message.slice('JSON 语法错误：'.length);
  for (const prefix of ['无法读取示例', '无法读取文件']) {
    if (message.startsWith(prefix + '：'))
      return uiText(prefix) + ': ' + message.slice((prefix + '：').length);
  }
  const firstScene = /^为首个分镜设置 (.+)，以避免提前显示未来对象。$/.exec(message);
  if (firstScene)
    return `Set ${firstScene[1]} for the first shot to avoid revealing future objects.`;
  // Generic graph diagnostics that name a field, a limit or the allowed values.
  const mustBe = /^(\S+) 必须是(数组|对象|布尔值)。$/.exec(message);
  if (mustBe)
    return `${mustBe[1]} must be ${{ 数组: 'an array', 对象: 'an object', 布尔值: 'a boolean' }[mustBe[2]]}.`;
  const textLimit = /^使用不超过 (\d+) 个字符的(非空)?文本。$/.exec(message);
  if (textLimit)
    return `Use ${textLimit[2] ? 'non-empty ' : ''}text of at most ${textLimit[1]} characters.`;
  const tooLarge = /^图谱过大（上限 (\d+) 个节点、(\d+) 条关系）。$/.exec(message);
  if (tooLarge)
    return `The graph is too large (limit: ${tooLarge[1]} nodes, ${tooLarge[2]} relations).`;
  const large =
    /^图谱较大（(\d+) 个节点、(\d+) 条关系），超出流畅预览的范围（约 (\d+) 个节点、(\d+) 条关系）。$/.exec(
      message,
    );
  if (large)
    return `The graph is large (${large[1]} nodes, ${large[2]} relations), beyond what previews smoothly (about ${large[3]} nodes, ${large[4]} relations).`;
  const noEnd = /^关系缺少 (source|target)。$/.exec(message);
  if (noEnd) return `Relation has no ${noEnd[1]}.`;
  const allowed = /^可用：(.+)。$/.exec(message);
  if (allowed) return `Allowed: ${allowed[1].split('、').join(', ')}.`;
  const offAxis = /^(\d+) 个带日期的节点横坐标不在其时间上，已按日期绘制。$/.exec(message);
  if (offAxis)
    return offAxis[1] === '1'
      ? '1 dated node has an x that is not its place in time; it is drawn at its date.'
      : `${offAxis[1]} dated nodes have an x that is not their place in time; they are drawn at their dates.`;
  const laneOnly = /^(\d+) 个节点的坐标只有 y，其横坐标无法由日期得出，已重新摆放。$/.exec(message);
  if (laneOnly)
    return laneOnly[1] === '1'
      ? '1 node gives y alone, but its x cannot be taken from its dates; it was placed again.'
      : `${laneOnly[1]} nodes give y alone, but their x cannot be taken from their dates; they were placed again.`;
  const implicit = /^(\d+) 个节点只在关系中出现，已按 id 自动创建。$/.exec(message);
  if (implicit)
    return implicit[1] === '1'
      ? '1 node appears only in relations and was created from its id.'
      : `${implicit[1]} nodes appear only in relations and were created from their ids.`;
  return uiText(message);
}

/** Translate the known prefixes of UI action messages while retaining
 * arbitrary error details, filenames, and project/source content verbatim.
 */
export function uiStatus(message: string): string {
  if (selectedLanguage !== 'en') return message;
  if (hasUiText(message)) return uiText(message);
  for (const prefix of [
    '配置无效：',
    '图片配置超出容量或包含无效字段：',
    '保存失败：',
    '导出失败：',
  ]) {
    if (message.startsWith(prefix))
      return uiText(prefix) + uiDiagnostic(message.slice(prefix.length));
  }
  const blockedPrefix = '时间轴会横向移动已锁定的节点：';
  for (const blockedSuffix of ['。请先解锁它们，或改选其他布局。', '。请先解锁它们，再重置。'])
    if (message.startsWith(blockedPrefix) && message.endsWith(blockedSuffix))
      return (
        uiText(blockedPrefix) +
        message.slice(blockedPrefix.length, -blockedSuffix.length).split('、').join(', ') +
        uiText(blockedSuffix)
      );
  const exportPrefix = '已准备导出：';
  const exportSuffix = '。此文件仅保存源数据坐标，不代表完整项目已保存。';
  if (message.startsWith(exportPrefix) && message.endsWith(exportSuffix))
    return (
      uiText(exportPrefix) +
      message.slice(exportPrefix.length, -exportSuffix.length) +
      uiText(exportSuffix)
    );
  return uiDiagnostic(message);
}

/**
 * Make view-generated labels localizable without resetting their nested input
 * or select elements. Dynamic domain labels MUST use doc.createElement directly.
 */
export function uiElement<K extends keyof HTMLElementTagNameMap>(
  doc: Pick<Document, 'createElement'>,
  tag: K,
  text = '',
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (text) {
    element.textContent = uiText(text);
    if (hasUiText(text)) element.setAttribute('data-ui-key', text);
  }
  return element;
}
type TextBinding = { node: Text; source: string };
type AttributeBinding = { element: Element; name: string; source: string };
const textBindings = new WeakMap<Document, TextBinding[]>();
const attributeBindings = new WeakMap<Document, AttributeBinding[]>();

/** Snapshot only the initial HTML UI, before asynchronous source data loads. */
export function captureStaticStudioUi(doc: Document): void {
  if (typeof doc.createTreeWalker !== 'function' || !doc.body) return;
  const textEntries: TextBinding[] = [];
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? '';
    const key = text.trim();
    if (!hasUiText(key) || !key || node.parentElement?.closest('script,style')) continue;
    textEntries.push({ node: node as Text, source: text });
  }
  const attrs: AttributeBinding[] = [];
  for (const element of doc.body.querySelectorAll('*')) {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const source = element.getAttribute(name);
      if (source && hasUiText(source)) attrs.push({ element, name, source });
    }
  }
  textBindings.set(doc, textEntries);
  attributeBindings.set(doc, attrs);
}

/** Update existing text nodes only; never replace containers holding controls. */
export function refreshStudioUi(doc: Document): void {
  doc.documentElement?.setAttribute('lang', selectedLanguage);
  for (const { node, source } of textBindings.get(doc) ?? []) {
    const key = source.trim();
    if (node.isConnected) node.textContent = source.replace(key, uiText(key));
  }
  for (const { element, name, source } of attributeBindings.get(doc) ?? []) {
    if (element.isConnected) element.setAttribute(name, uiText(source));
  }
  if (typeof doc.querySelectorAll !== 'function') return;
  for (const element of doc.querySelectorAll<HTMLElement>('[data-ui-key]')) {
    const key = element.getAttribute('data-ui-key');
    if (!key) continue;
    const first = element.firstChild;
    if (first?.nodeType === 3) first.textContent = uiText(key);
    else if (!first) element.textContent = uiText(key);
  }
}
