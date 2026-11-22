# 用 RelGraph Studio 与外部工具协作制片

把关系图当作一项可重新渲染的视频素材。作者在 Studio 中编辑人物、关系词、可见年份和分镜；Studio 渲染观众实际看到的节点、连线和标签。科学插图可以交给 Pillow 或其他绘图工具，音轨由音乐工具制作，最后用 FFmpeg 或剪辑软件合成。

[观看 13 秒协作样片](../datasets/quantum-history/workflow/positron.mp4) · [镜头配方](../datasets/quantum-history/workflow/positron.json) · [原始图谱](../datasets/quantum-history/quantum-history.graph.json)

## 先跑通一个镜头

在仓库根目录使用项目支持的 Node.js 版本并安装 FFmpeg（含 libx264）和 ffprobe。中文片还应安装覆盖片中文字的中文字体，供内置字体子集回退使用。

```sh
npm ci
npm run build:packages
node scripts/compose-video-shot.mjs datasets/quantum-history/workflow/positron.json output/positron-v1
```

打开 `output/positron-v1/shot.mp4`。画面上方是外部绘制的相对论能谱图；下方的关系、标签、标题和解说由 Studio 的无头渲染器逐帧绘制。FFmpeg 将两部分上下拼接，并从原片音乐的 01:23 开始取音。成片为 1080 × 1920、60 fps、13 秒。输出路径取一个新目录名，方便并排比较不同版本。

## 从创作到交付

| 步骤            | 作者的操作                                                                                                                                                      | 交给下一步的内容                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1. 写关系和分镜 | 在通用图或 Studio 项目里写节点、带动词的边和历史可见范围。在 `presentation` 中指定镜头 ID、时长、取景对象和解说。通过 Studio 修改显示文字后，保存**完整项目**。 | 一个权威的图谱或 `.studio.json` 文件               |
| 2. 准备外部素材 | 给该镜头画科学示意图，准备全片音轨。在配方里引用文件和镜头 ID，可按节点 ID 指定构图位置。                                                                       | 插图、音轨、镜头配方。边的文字始终从图谱或项目读取 |
| 3. 渲染和对时   | 按交付帧率编译 Studio 时间线，从已投影的镜头中取可见对象。用同一帧率生成画面和事件。                                                                            | 原生图形画面、镜头事件、在全片时间线上的帧偏移     |
| 4. 合成         | 外部绘图工具或剪辑软件使用事件安排动画，使用帧偏移截取全片配乐。参考脚本直接调用 FFmpeg 完成拼接。                                                              | 含音轨的 MP4                                       |
| 5. 复核与交付   | 在手机尺寸检查箭头归属、关系词和中文字形；检查导出尺寸、帧数和音轨时长。保存配方、输入素材及图谱版本。                                                          | 可播放的成片，以及可以重跑的制作输入               |

### 镜头配方和时间约定

参考脚本使用一个 JSON 配方。`document` 指向可导入 Studio 的源文件或完整项目，`shot` 是作者给分镜的稳定 ID，`fps` 是正整数，`plate` 是外部静态图片，`music` 是从全片零时刻开始的音轨。所有素材路径均相对于配方文件。`positions` 可选，以源节点 ID 映射到世界坐标 `{x, y}`，用于局部镜头排版。源节点自带的坐标优先。

脚本适合有 `camera.fitIds` 的简单镜头：取该章历史时间下可见的聚焦节点及其相互之间的边，将其独立排成一幅 1080 × 1440 的 Studio 画面，上方为 1080 × 480 的插图区域。它突出全部入选关系，局部镜头从第 0 帧开始，独立播放。跨镜头的摄像机过渡、节拍或证据卡需要保留时，用下节的整片流程。此版合成使用不透明画面拼接。

| 输出          | 时间坐标与用途                                                                             |
| ------------- | ------------------------------------------------------------------------------------------ |
| `shot.mp4`    | 单镜头画面和音频从零开始，短音轨末尾补静音                                                 |
| `shot.json`   | 记录源镜头 ID、全片起始帧、起始秒数、帧率和帧数，供剪辑软件放回全片                        |
| `events.json` | 该局部镜头实际使用的 `relgraph.events/1` 事件，帧号从零开始；外部动画按事件的 `frame` 对齐 |

样片从全片第 4980 帧开始，交付 780 帧，覆盖半开区间 `[4980, 5760)`。镜头内事件的帧号加上 4980 就是全片帧号。修改前面章节的时长后，重跑配方会重新计算这个偏移。

### 整片与其他剪辑工具

连续分镜、自动推导的分镜或带证据卡的项目可以直接用原生 CLI 导出。以下命令从同一文档生成整片画面、音频和全片事件文件。CLI 内置的这个竖屏规格为 24 fps；上面的 60 fps 样片通过渲染 API 指定帧率。外部编辑器按所用路径的实际事件帧率设置时间线。

```sh
npm run relgraph -- render datasets/quantum-history/quantum-history.graph.json \
  --frame-spec portrait-1080x1920 --theme light \
  --audio datasets/quantum-history/score.m4a \
  --events output/quantum.events.json --out output/quantum-native.mp4
```

把 MP4 导入剪辑软件作为关系图视频轨，用全片事件中的 `shot`、`caption`、`reveal` 定位插图或声音。需要逐帧处理时，CLI 也可以导出 PNG 序列，并用 `--from`、`--to` 选取含两端的帧范围。[原生导出说明](../README.md#export-a-film-without-a-browser)

## 用一次改字验收整个流程

在 Studio 中打开原图，选中“狄拉克方程 → 正电子”，把边的显示文字改为“1931 年预言”。保存完整项目，把配方的 `document` 指向保存的文件，再渲染到 `output/positron-v2`。对比同一秒的两个画面：新文字应出现在原生关系图中，“发现”仍从安德森指向正电子，图上方的能谱、音乐起点和 780 帧时长应一致。需要查规格时可运行：

```sh
ffprobe -v error -count_frames \
  -show_entries stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration,channels \
  -of json output/positron-v2/shot.mp4
```

换题材时，先替换配方所指的图谱、镜头 ID、插图和配乐。确认一个镜头能随 Studio 的编辑正确更新，再扩展全片。
