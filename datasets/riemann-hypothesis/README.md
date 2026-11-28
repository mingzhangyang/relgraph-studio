# 《黎曼猜想：从欧拉乘积到机器检查的证明》制作笔记

[竖向时间轴项目](./riemann-hypothesis.studio.json) · [通用图谱](./riemann-hypothesis.graph.json) · [试听配乐](./score.m4a)

这部 3 分 53 秒的竖屏短片沿一条自上而下的时间轴，从 1737 年欧拉乘积公式讲到 2026 年 11 月的 Lean 形式化证明。**全部 5,592 帧由 RelGraph Studio 的无头渲染器直接绘制**（视频不入库，按下文“重现”一节在本地生成）：节点、关系、时间刻度、字幕和镜头运动都来自同一份图谱与分镜。图谱可以拖进 Studio 自由浏览，影片给第一次接触黎曼猜想的观众安排了一条 17 章的阅读路线。

## 图谱里有什么

| 类别          | 数量 | 画法             | 例子                                           |
| ------------- | ---- | ---------------- | ---------------------------------------------- |
| 人物          | 26   | 墨绿胶囊         | 黎曼、哈代、塞尔伯格、蒙哥马利、戴森、阿尔珀格 |
| 研究团队与 AI | 8    | 蓝色胶囊         | 普拉特与特鲁吉安、古思与梅纳德、Claude 研究版  |
| 理论与成果    | 23   | 铜色方框         | 素数定理、对关联猜想、超过 2/3 且为单零点      |
| 数值验证      | 4    | 绿色方框         | 前 15 个零点、验证到高度 3·10¹²                |
| 问题与事件    | 5    | 紫色菱形（含字） | 黎曼猜想、希尔伯特第八问题、千禧年大奖难题     |

共 66 个节点、60 条带动词的关系。每个节点按其关键成果的年份出现在时间轴上（`visibleFrom`），人物的生卒年写在 `summary` 里。成果节点的 `evidence` 列出原始文献；1859 年论文那句“es ist sehr wahrscheinlich, dass alle Wurzeln reell sind”、Lamzouri 摘要与 Lean 社区声明的原文也作为引文保存。

## 17 章分镜

| 时间 | 章节                          | 领域时间 |
| ---- | ----------------------------- | -------- |
| 0:00 | 素数有规律吗？                | 1798     |
| 0:13 | 从级数到估计                  | 1850     |
| 0:25 | 1859：一篇八页的论文          | 1859     |
| 0:40 | 素数定理终于证明              | 1905     |
| 0:53 | 第八问题与前 15 个零点        | 1903     |
| 1:05 | 剑桥的两个人                  | 1914     |
| 1:18 | 遗稿里的计算                  | 1932     |
| 1:30 | 零点占多少？                  | 1942     |
| 1:43 | 另一个世界已经证明            | 1974     |
| 1:57 | 机器开始数零点                | 1953     |
| 2:09 | 一次茶歇                      | 1987     |
| 2:24 | 比例接力                      | 2020     |
| 2:38 | 百万美元与一个宣称            | 2018     |
| 2:52 | 逼近边界                      | 2024     |
| 3:07 | 2026 年 8 月：越过三分之二    | 2026     |
| 3:22 | 2026 年 11 月：机器检查的证明 | 2026     |
| 3:39 | 167 年                        | 2026     |

领域时间不总是单调递增：第 9 章讲完有限域上的故事后，第 10 章回到 1953 年的图灵。Studio 的剧透投影保证每章只显示当年已出现的节点。

## 2026 年的进展怎样核对

近期事件只写有一手来源支撑的内容：

- **2026 年 8—9 月，超过 2/3。** Lamzouri 的 [arXiv:2609.02882](https://arxiv.org/abs/2609.02882)（2026-09-02 提交）摘要写明：超过 67.25% 的非平凡零点是单零点且在临界线上；这一界“very recently produced by an internal research version of Claude developed by Anthropic”，并由 Levent Alpöge 与 Ralph Furman 核验。Lamzouri 用单个希尔伯特空间不等式给出更短的新证明，输入是蒙哥马利对关联定理的无条件形式。此前的纪录是 Pratt、Robles、Zaharescu、Zeindler（2020）的 5/12。
- **2026 年 11 月，Lean 证明。** Lean FRO 与 Mathlib Initiative 于 2026-11-21 发布[联合声明](https://leanprover-community.github.io/blog/posts/riemann-hypothesis/)：Alpöge 于 11 月 20 日发布约 1700 万行的 Lean 证明库，定理陈述即 Mathlib 中的 `RiemannHypothesis`，代码能编译，导出的证明通过 Lean 内核和多个独立检查器。声明没有说数学家已审阅其中的数学思想。影片第 16 章因此说“证明中的数学思想仍待人们读懂和审阅”，节点关系写作“宣称解决”千禧年大奖难题，而不是“解决”。
- **未写入的内容。** 搜索中出现的其他说法（例如某模型把零点限制在更窄的带状区域）未找到一手来源，没有写入。媒体对 “25 万页” 说法的报道无法打开原文，也未写入。

更早的结果以原始论文为准，条目列在各节点的 `evidence` 中（如 Platt & Trudgian, _Bull. LMS_ 53 (2021)；Guth & Maynard, arXiv:2405.20552）。这些引文按通行文献整理，没有逐条对照扫描件。

## 排版：竖向时间轴上的 66 个节点

项目文件设置了 `config.view.timeAxis: "vertical"`，时间从上往下走，适合 1080 × 1920 竖屏。时间坐标由日期推导，约 18 个世界单位一年；作者只写节点的横向位置（`position.y`，竖向绘制时就是画面横坐标）。`build_graph.py` 用一个贪心算法排它：

1. 黎曼猜想、希尔伯特第八问题、千禧年大奖难题占最左边一列。这条“问题主线”上的连线不会穿过其他节点。
2. 其余节点按年份从早到晚放入，尽量靠近所属类别的列和已放好的关联节点。
3. 年份相差不足 3.4 年的节点视为同一行；同一行的节点按文字宽度（与渲染器 `estimateTextWidth` 同一规则）左右排开，互不重叠。

方框里的文字在屏幕上大小固定，跨越几十年的镜头会把它们挤在一起。所以跨度大的章节（第 9、12、14 章和结尾）用 `beats` 让镜头沿时间轴移动，每一站只取景几十年内的节点。2026 年的两个里程碑同在一年，而画面顶部的领域时间只按整数年显示，所以两者的 `visibleFrom` 都是 2026。第 16 章用 `reveal` 节拍让 Lean 节点在镜头开始后才淡入，再把镜头移过去；第 15 章画面右侧会以淡色提前出现“Lean 社区”节点，这是用整数年份换来的已知折中。

## 重现

在仓库根目录，按 [README](../../README.md#export-a-film-without-a-browser) 安装 Node.js、FFmpeg 后：

```sh
npm ci
npm run build:packages
python3 datasets/riemann-hypothesis/build_graph.py           # 生成 .graph.json 与 .studio.json
npx prettier --write datasets/riemann-hypothesis/*.json      # 与仓库格式一致
python3 datasets/riemann-hypothesis/make_score.py 233 output/score.wav
ffmpeg -i output/score.wav -c:a aac -b:a 160k output/score.m4a
F=datasets/riemann-hypothesis/riemann-hypothesis.studio.json
npm run relgraph -- validate $F
npm run relgraph -- check-labels $F --frame-spec portrait-1080x1920
npm run relgraph -- render $F --frame-spec portrait-1080x1920 --theme light \
  --audio output/score.m4a --out output/riemann-hypothesis.mp4
```

配乐由 `make_score.py` 只用 NumPy 合成：A 小调四和弦循环，76 BPM，拨弦琶音配柔和长音，首尾淡入淡出；同样的参数得到同样的文件。

## 交付时核对了什么

- `relgraph validate`：无错误、无警告（包括字幕阅读速度）。
- `relgraph check-labels --frame-spec portrait-1080x1920`：17 个镜头的 51 个稳定帧没有标签被省略。
- `relgraph check-layout`：仍报告部分淡色背景节点贴近或过挤（取景较宽时方框按屏幕尺寸绘制）；逐条核对后，每章取景和高亮的节点之间没有过挤。
- `relgraph render` 没有报告字体缺字（起初的上标 ⁰ 和数学减号 − 已改写为内置字体覆盖的字符）。
- `ffprobe`（本地生成的成片）：H.264 1080 × 1920、24 fps、5,592 帧、233.0 秒；AAC 音轨 233.0 秒。
- 抽取每章中段的画面，在手机尺寸下逐章检查了字幕、聚焦节点与关系箭头。

## 小红书配图与文案

[`xiaohongshu/`](./xiaohongshu/) 收录 9 张 1080 × 1440（3:4）配图和[发布文案](./xiaohongshu/文案.md)。配图用 HTML 排版、仓库内置的 Noto CJK 字体，由 Playwright 的无头 Chromium 截图；封面曲线是用黎曼–西格尔公式算出的 Hardy Z(t)。重新生成：

```sh
python3 datasets/riemann-hypothesis/xiaohongshu/make_cards.py   # 写出 cards.html（不入库）
node datasets/riemann-hypothesis/xiaohongshu/shoot.mjs          # 截图为 01-cover.png … 09-end.png
```

## 列表版

[列表项目](./riemann-hypothesis.list.studio.json)：同一份图谱、17 章分镜和配乐，同样 3 分 53 秒，画面换成 RelGraph Studio 的列表形式（`config.view.mode: "list"`）。每个节点占一行，按时间排列：时间、类别标记、名称、简介，以及写成短语的关系（“黎曼 提出”“提出 黎曼猜想”）。本章出现的行依次展开，后面的行随之下移；本章高亮的行加底板，其余变淡；镜头的取景和节拍让列表滚动到对应的行。全部帧仍由 `relgraph render` 绘制，视频同样不入库，用下面的命令生成；在 Studio 的“画面形式”菜单里可以在关系图和时间列表之间切换。

```sh
npm run relgraph -- render datasets/riemann-hypothesis/riemann-hypothesis.list.studio.json \
  --frame-spec portrait-1080x1920 --theme light \
  --audio datasets/riemann-hypothesis/score.m4a --out output/riemann-hypothesis-list.mp4
```
