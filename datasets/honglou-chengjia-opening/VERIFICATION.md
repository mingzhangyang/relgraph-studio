# 《红楼梦》程甲本开篇亲缘子集 · B2-1 来源核实报告

**B2-1 数据审查稿。** 验收修复 #19、#20 均已合并；本分支从最新 main
`a051d019d68ce2482de9e0ce4605fbb4f1862743` 更新而来，与运行时修复分开交付。
本数据仍需独立 PR 审查后才能作为 B2-2 正式制作输入。

本批限定第二、三回的 **6 人、9 条关系**：8 条原文直证、1 条亲缘支系推导。
它与 `examples/honglou-provisional.relgraph.json` 分开保存，不替换技术演示。
核实日期：2026-11-08；2026-11-10 经编辑审校补核 P62 并修订推导边标签（见文末修订记录）。状态是本次对原文的证据核对结果，尚待 PR 审查，
不等于全书考据或跨版本校勘已经完成。

## 版本与来源

采用 **乾隆五十六年（1791）萃文书屋木活字程甲本第一册** 的公版扫描，
以及与该扫描逐页对应的维基文库转录。
[国家图书馆出版社书目](https://www.nlcpress.com/ProductView.aspx?Id=3837)
说明程甲本初印及其影印底本背景；本批没有使用该现代影印本的校注或编辑正文。

前八十回通常归属曹雪芹；程伟元、高鹗整理刊行程甲本一百二十回。
后四十回作者归属存在争议。本批只取前八十回中的第二、三回，
不把书目中的合署作者解释为争议已经解决，也不混入脂本、程乙本或通行汇校本。
[程甲本目录及程、高原序](https://zh.wikisource.org/wiki/紅樓夢（程甲本）)
可供检查版本背景；现代版本介绍只提供书目定位，不充当人物关系的原著证据。

`sources.json` 锁定：

- 原扫描文件名称、下载 URL、21,937,106 字节及 SHA-256
  `18d5e5b6380faa64319d11e1a106a072f2a3b57c769af81d1d83c256509915ba`。
- 第一至三回阅读窗口的 **39 个底层 Page 修订**，含修订号、时间、固定链接、
  原始 wikitext SHA-256、PDF 页码和网站校对等级。
- **16 条短原文证据**；逐条记录回目、上下文、来源页、核实状态及核实日期。
- 原扫描 PDF 第 **58、61、62、63、65、68、69、70、75、76** 页的相关证据段
  已人工视觉核对。未对全部 39 页宣称完成独立扫描校对。

PDF 页码从 1 开始，是文件页序，不是印本叶码。第二回转录部分在网站仍为
“未校对”（level 1），不能仅凭网站标签声称可靠；本批另行核对了所用证据段。
底层转录中的现代校勘模板、异文提示和页眉页脚不作为人物事实证据。

只固定章节页不够：章节页会转嵌当前底层 Page 内容。章节页即使带 `oldid`，
其转嵌内容仍可能更新。因此本批固定底层原始修订并检查其摘要，避免静默漂移。

## 逐条关键事实

以下链接指向所采用的固定转录修订；每条完整短证据及扫描位置均在来源台账中。
引文保留底本字形和转录标点；显示名与小传采用简体，不把简体改写伪装成逐字引文。

| ID / 事实 | 来源与证据 ID | 状态 / 可见阈值 |
| --- | --- | --- |
| `lin-marriage` 林如海与贾敏的生前婚姻 | 第二回 [P58](https://zh.wikisource.org/w/index.php?oldid=2441196)、[P65](https://zh.wikisource.org/w/index.php?oldid=2441203)：`lin-daughter`、`min-identity`、`min-death` | 直证，高可信；2 |
| `ruhai-daiyu` 林如海—黛玉父女 | 第二回 [P58](https://zh.wikisource.org/w/index.php?oldid=2441196)：`lin-daughter` | 直证，高可信；2 |
| `min-daiyu` 贾敏—黛玉母女 | 第二回 [P58](https://zh.wikisource.org/w/index.php?oldid=2441196)、[P65](https://zh.wikisource.org/w/index.php?oldid=2441203)：`lin-daughter`、`min-identity` | 直证，高可信；2 |
| `mu-zheng` 贾母—贾政母子 | 第二回 [P61](https://zh.wikisource.org/w/index.php?oldid=2441199)、[P65](https://zh.wikisource.org/w/index.php?oldid=2441203)：`shi-sons`、`shi-living`、`shi-alias` | 直证，高可信；2 |
| `zheng-min` 贾政—贾敏兄妹 | 第二回 [P65](https://zh.wikisource.org/w/index.php?oldid=2441203)：`min-identity` 明言“赦政二公之胞妹” | 直证，高可信；2 |
| `zheng-baoyu` 贾政—宝玉父子 | 第二回 [P63](https://zh.wikisource.org/w/index.php?oldid=2441201)、[P65](https://zh.wikisource.org/w/index.php?oldid=2441203)：`baoyu-jade-birth`、`baoyu-name`、`baoyu-father` | 直证，高可信；2 |
| `mu-min` 贾母—贾敏母女 | 第三回 [P70](https://zh.wikisource.org/w/index.php?oldid=2441208)：`mu-min`；第二回锁定黛玉之母身份 | 直证，高可信；3 |
| `mu-daiyu` 贾母—黛玉外祖母与外孙女 | 第三回 [P70](https://zh.wikisource.org/w/index.php?oldid=2441208)：`grandmother`，叙述者在拜见段直接确认 | 直证，高可信；3 |
| `baoyu-daiyu` 宝玉—黛玉姑舅表兄妹 | 第三回 [P75](https://zh.wikisource.org/w/index.php?oldid=2441213)：`cousin` 直称“表兄”；姑表支系另由第二回三条直证亲缘推出 | **推导**，高可信但不标为直证；3 |

“姑舅表”推导依赖 `zheng-min`、`min-daiyu`、`zheng-baoyu`。
关系标签本身含“亲缘推导”，转录及画面也会保留这个限定。
`evidenceConfirmedAt` 是本批选用的明确证据节点，不宣称是读者最早能推知关系的时刻；
例如第二回已能推知一些外亲，第三回的外祖母明确称谓仍取 3 作为保守揭示阈值。

| 人物显示名 | 姓名、别名和身份依据 | 首次明确提及 |
| --- | --- | --- |
| 林如海；别名林海 | `lin-name`：名海、字如海，[P58](https://zh.wikisource.org/w/index.php?oldid=2441196) | 第二回正文 |
| 贾敏 | 第二回先称嫡妻贾氏，后 `min-identity` 明确命名并说明为林公夫人、贾政胞妹 | 第二回正文 |
| 林黛玉；别名黛玉 | 第二回 `lin-daughter` 已明确林家之女、乳名黛玉；完整连写姓名见第三回 `daiyu-full-name` [P69](https://zh.wikisource.org/w/index.php?oldid=2441207) | 第二回正文，以乳名识别 |
| 贾母；别名史老夫人 | 第二回以史侯小姐、太夫人、史老夫人明确指称；第三回叙述者称贾母，不虚构闺名 | 第二回正文，以身份识别 |
| 贾政；别名字存周 | 第二回具名；第三回 `zheng-alias` [P68](https://zh.wikisource.org/w/index.php?oldid=2441206) 才核实存周 | 第二回正文 |
| 贾宝玉；别名宝玉 | 第二回明确为政公衔玉之子并以寳玉回指；规范显示名补明确贾姓；第三回 `baoyu-alias` [P76](https://zh.wikisource.org/w/index.php?oldid=2441214) 复核小名 | 第二回正文，以人物身份识别 |

`firstAppearance` 在本数据中特指“正文首次命名或无歧义指称”，对应既有适配器的
节点可见阈值，并非“首次登台”。首次登台未作系统核实，字段明确标为未审计，
不填猜测值。第一回神话人物和“通灵寳玉”物件不据此等同于贾宝玉等人的初次出场。
贾政别名存周的证据仍记为第三回，不能因节点在第二回可见就把它提前写进小传。

## 数据与剧透约定

- 不改既有 Schema、适配器、投影、时间轴或渲染逻辑。既有 `bio.quotes`、
  `relations[].evidence` 保存短证据，`extra.provenance` 记录状态、证据 ID、
  推导依赖、首次提及及安全阈值，旁置台账负责版本和修订定位。
- 人物小传只写第二回已知内容。第三回的佐证引文保留 `at: 3`，经已有安全小传访问器过滤。
  别名列表和 provenance 是原始资料，不能绕过投影直接当作字幕或无障碍文本。
- 血缘的精确成立日期未知；`chapters.from` 是读者知情阈值。
  “夫妻（生前）”表示已叙明的历史婚姻，不暗示已去世的贾敏仍健在。
- 所有边 `strength: 2`、`polarity: neutral` 是统一图形编码，
  不声称原著给出了亲疏分值或感情判断。
- 审查范围止于第三回。不使用后续恋爱、婚姻、命运或年龄计算；
  排除项与争议状态记录在台账，不能冒充已经核实的图谱事实。
- 回级保护以“读完该回”为知情节点，**不保证同一回内部的逐句防剧透**。
  `graph.relgraph.json` 中 1 → 2 → 3、每段 1 秒的 `presentation` 仅为数据 QA，
  确保既有加载器、投影和随机帧路径可运行；不是正式影片或正式字幕。

## 复现与质量检查

```bash
npm ci
npm run build:packages
npm run relgraph -- validate datasets/honglou-chengjia-opening/graph.relgraph.json --json
npm test -- tests/honglou-dataset.test.mjs
npm run check:honglou-sources
```

联网核查命令需 `curl`，不运行在 Studio 中，也不属于普通离线测试。
它重取 39 个精确底层修订，检查页面身份、原始摘要、15 条证据的逐字包含关系，
并下载公版原扫描核对字节数及 SHA-256。已有下载可复用：

```bash
npm run check:honglou-sources -- --scan-file /path/to/original.pdf
```

自动校验“引用确实在被锁定的文本中”，不能替代原文解释与扫描阅读。
本次已实际运行联网核查：39/39 修订、15/15 短证据、扫描摘要通过。
新增 7 项测试覆盖唯一 ID、引用目标、区间、完整来源、推导依赖、
别名/小传时间边界、投影撤回、两种尺寸/主题下全部 72 个 QA 帧乱序一致，
以及缺失修订、错误页面、摘要变更、伪造引文的拒绝行为。

在合并 #20 后、以 `a051d01` 为基线的本分支上实际执行：

| 验证层 / 命令 | 实际结果 |
| --- | --- |
| `typecheck`、`lint`、`format:check`、`check:types` | 全部通过；格式检查也覆盖新增 JSON |
| `npm test -- --reporter=verbose` | **181/181**，25 个文件；含新增 7 项纯函数/数据质量测试，以及既有 15 项共享 VM 工作区测试；不是 181 项浏览器测试 |
| `build:packages`、`build` | core/render/CLI 独立 JS 与声明构建、Studio 生产构建均通过 |
| `relgraph validate … --json` | `valid: true`，0 错误、0 警告 |
| `check:browser`，真实 Chromium 153.0.8010.12 | **39/39**；新增数据在浅/深主题下本地导入、章节边界、倒退撤回、转录和随机访问 PNG 一致性通过 |
| 既有浏览器基线精确 SHA-256 比较 | **16/16 PNG 逐字节一致**；未重写基线 |
| 新数据真实 Skia 帧检查 | **4/4** 分辨率/主题组合；帧 0/23/24/47/48/71 共 24 个样本倒序重算 RGBA 摘要一致，实际绘制文本字形均由内置字体覆盖 |
| `check:export` | **5/5**；**44/44** 既有 Golden frames 不变；原有文学/生物技术示例的完整 1080p MP4、ffprobe 及 PNG/视频回读通过 |
| `check:honglou-sources` 默认联网下载，以及 `--scan-file` 复用路径 | 两条路径均实际通过：**39/39** 固定修订、**15/15** 引文、原扫描字节数及 SHA-256 一致 |

环境仍为 Linux x64、Node 24.22.1、skia-canvas 4.0.0、FFmpeg/ffprobe 7.1.5。
复用本会话已由 `npm ci` 安装的 157 个锁定依赖；本批没有新增依赖或修改 lockfile。
代理联网、浏览器和嵌套包测试在获准的外层执行环境运行，没有遗留访问阻碍。
没有触发 Actions CI；本仓库没有新增工作流。

本数据没有制作正式 MP4；导出回归只使用既有技术示例，新数据只生成 QA 静帧。
日志保存在本地忽略目录 `output/b2-1-final/`，浏览器截图在 `output/browser-check/`。
不把纯组合、模拟 DOM、真实浏览器、Skia 或 MP4 验证混为同一种测试。

## 权利与后续审查

原著正文为公版；仅收录短证据，保留维基文库固定修订署名来源及其
[使用条款](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use)。
不复制现代校注、出版社介绍正文、完整扫描或完整数字文本进 Git。
仓库本身的授权选择不由本数据批次改变。

仍需在 B2-2 前完成：对本 PR 的人工复核、拟用逐镜文案的章节与措辞审查、
精确出场定义（若文案使用“初登场”）、正式布局/字号/文本可读性 QA。
跨版本异文对勘、后四十回作者问题不在本次完成范围。
下一阶段入口见 [B2-2 交接说明](B2-2-HANDOFF.md)。

回滚：撤销本批数据、台账、核查脚本、测试及文档即可，不涉及 Schema、
持久化数据迁移或图谱内核回滚；provisional 示例始终保留。

## 2026-11-10 编辑审校修订记录

应 B2-2 前编辑审校（审校结论：通过，附两项修改建议；MZ 于 2026-11-10 拍板执行）：

1. **推导边标签**：`baoyu-daiyu` 由「姑表兄妹（亲缘推导）」改为「姑舅表兄妹（亲缘推导）」。
   「姑表」只命名宝玉一侧（贾敏为其姑母）；黛玉一侧贾政为其舅父，合称「姑舅表」才双向严密。
   推导依赖与揭示阈值不变。
2. **补核 P62、新增证据 `baoyu-jade-birth`**：冷子兴原述政公夫人王氏次年所生公子衔玉而生
   （P62，承 P61 诸子之序），列为 `zheng-baoyu` 的首要证据，`jia-baoyu` 与 `baoyu-daiyu`
   的证据链同步加入。须更正审校建议的原表述：程甲本此段**没有**「取名叫作宝玉」一句，
   该句是通行本文字；程甲本中宝玉之名由同回雨村回指（`baoyu-name`）确立，本次补入的是
   「衔玉而生」的原述本身，父子关系自此由原述直证、回指负责定名，分工更准确。
   引文止于「玉」：转录将该句扫描底本的「來」简作「来」，截断引文以保证逐字保真；
   P62 的 `scanReview` 据此改为 `evidence-passages-checked`。
3. **日期与测试不变量**：台账 `verifiedAt` 更新为 2026-11-10；原 15 条证据的 `checkedAt`
   保持 2026-11-08 不变。`tests/honglou-dataset.test.mjs` 相应把逐条
   `checkedAt == verifiedAt` 改为 `checkedAt <= verifiedAt`（不得晚于台账核实日期）。
4. 上文「复现与质量检查」中的运行结果（15/15 引文等）为 2026-11-08 的历史记录，未改写；
   合并本修订后须重跑 `npm run check:honglou-sources`（应为 39/39 修订、16/16 引文）
   与数据集测试，再作为 B2-2 正式制作输入。
