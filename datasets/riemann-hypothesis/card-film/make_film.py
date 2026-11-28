"""Write film.html: the Riemann Hypothesis film as an animated vertical timeline list.

    python3 datasets/riemann-hypothesis/card-film/make_film.py
    node datasets/riemann-hypothesis/card-film/render.mjs <out.mp4> [--audio score.m4a]

Chapters (titles, narration, durations) are read from ../build_graph.py, so this film
and the RelGraph Studio film share one storyboard and one soundtrack timing. The page
exposes setTime(seconds), a pure function of time, which render.mjs calls per frame.
"""

import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("build_graph", HERE.parent / "build_graph.py")
bg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bg)

FONTS = "../../../packages/render/fonts"

ERAS = {  # chapter index (1-based) -> era heading
    **{i: ("起源", "1737 — 1905") for i in range(1, 6)},
    **{i: ("二十世纪", "1914 — 1987") for i in range(6, 12)},
    **{i: ("逼近", "1974 — 2024") for i in range(12, 15)},
    15: ("最新进展", "2026"), 16: ("最新进展", "2026"), 17: ("167 年", "1859 — 2026"),
}

# (chapter, sort key, year label, who, what, kind[, extra html])
ENTRIES = [
    (1, 1737, "1737", "欧拉", "欧拉乘积公式：全体素数的乘积 = 全体正整数的级数", "result"),
    (1, 1798, "1798", "高斯 · 勒让德", "猜测 x 以内约有 x / ln x 个素数", "problem"),
    (2, 1837, "1837", "狄利克雷", "L 函数：等差数列中有无穷多素数", "result"),
    (2, 1850, "1850", "切比雪夫", "把素数个数夹在 x / ln x 的两个常数倍之间", "result"),
    (3, 1859, "1859", "黎曼", "8 页论文：ζ 函数延拓到复平面，写下“很可能所有零点都在 Re(s)=½”", "problem"),
    (4, 1896, "1896", "阿达马 · 德拉瓦莱普桑", "证明素数定理：关键是 Re(s)=1 上没有零点", "result"),
    (4, 1905, "1895 / 1905", "冯·曼戈尔特", "严格证明显式公式与零点计数公式", "result"),
    (5, 1900, "1900", "希尔伯特", "列为 23 个问题中的第 8 个", "problem"),
    (5, 1903, "1903", "格拉姆", "手算前 15 个零点，全在临界线上", "check"),
    (6, 1914.0, "1914", "哈代", "临界线上有无穷多个零点", "result"),
    (6, 1914.1, "1914", "李特尔伍德", "π(x) 与 li(x) 的大小关系会无穷多次反转", "result"),
    (7, 1932, "1932", "西格尔", "在黎曼遗稿中发现高效计算零点的公式", "result"),
    (8, 1940, "1940", "英厄姆", "限制偏离临界线的零点个数（零点密度估计）", "result"),
    (8, 1942, "1942", "塞尔伯格", "临界线上的零点占一个正比例", "result"),
    (9, 1948, "1948", "韦伊", "证明有限域上曲线的“黎曼猜想”", "result"),
    (9, 1974.1, "1974", "德利涅", "推广到一般代数簇，韦伊猜想全部证明", "result"),
    (10, 1953, "1953", "图灵", "第一次用电子计算机检查零点", "check"),
    (11, 1973, "1973", "蒙哥马利 · 戴森", "茶歇对话：零点间距像随机矩阵的本征值", "result"),
    (11, 1987, "1987", "奥德利兹科", "在第 10<sup>20</sup> 个零点附近验证这一统计规律", "check"),
    (12, 1974.0, "1974", "莱文森", "超过 1/3 的零点在临界线上", "result"),
    (12, 1989, "1989", "康雷", "超过 2/5", "result"),
    (12, 2020, "2020", "普拉特等四人", "超过 5/12（约 41.7%）", "result"),
    (13, 1999, "1999", "孔涅", "用非交换几何寻找“零点的算子”", "result"),
    (13, 2000, "2000", "克雷数学研究所", "千禧年大奖难题，奖金 100 万美元", "problem"),
    (13, 2018.7, "2018", "阿蒂亚", "宣布证明，未被数学界接受", "problem"),
    (14, 2018.0, "2018", "罗杰斯 · 陶哲轩", "证明 Λ ≥ 0：若猜想成立，便是“刚好成立”", "result"),
    (14, 2021, "2021", "普拉特 · 特鲁吉安", "严格验证前约 12.4 万亿个零点", "check"),
    (14, 2024, "2024", "古思 · 梅纳德", "首次整体改进英厄姆 1940 年的零点密度界", "result"),
    (15, 2026.6, "2026-08", "Claude 研究版", "证明超过 67.25% 的零点是单零点且在临界线上；阿尔珀格与弗曼核验", "result"),
    (15, 2026.7, "2026-09", "拉姆祖里", "用一个希尔伯特空间不等式给出更短的新证明", "result"),
    (16, 2026.9, "2026-11", "阿尔珀格", "发布约 1700 万行的 Lean 证明库，声称证明黎曼猜想", "problem",
     '<div class="status"><span class="yes">已确认：陈述即 Mathlib 中的黎曼猜想，可编译并通过内核检查</span>'
     '<span class="wait">仍在进行：数学家审阅证明思想</span></div>'),
]


def data():
    chapters, t = [], 0.0
    for i, sh in enumerate(bg.SHOTS, 1):
        era, span = ERAS[i]
        chapters.append({"title": sh["title"], "narration": sh["narration"], "start": t,
                         "dur": sh["dur"], "era": era, "span": span})
        t += sh["dur"]
    entries = []
    for row in ENTRIES:
        ch, key, year, who, what, kind = row[:6]
        extra = row[6] if len(row) > 6 else ""
        c = chapters[ch - 1]
        mates = [r for r in ENTRIES if r[0] == ch]
        k = mates.index(row)
        stagger = min(3.6, (c["dur"] - 3) / len(mates))
        entries.append({"ch": ch - 1, "key": key, "year": year, "who": who, "what": what,
                        "kind": kind, "extra": extra, "at": round(c["start"] + 0.5 + k * stagger, 3)})
    entries.sort(key=lambda e: e["key"])
    return {"total": t, "chapters": chapters, "entries": entries}


PAGE = r'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@font-face { font-family: "Sans"; src: url(FONTS/NotoSansCJKsc-Regular.subset.woff2); font-weight: 400; }
@font-face { font-family: "Sans"; src: url(FONTS/NotoSansCJKsc-Bold.subset.woff2); font-weight: 700; }
@font-face { font-family: "Serif"; src: url(FONTS/NotoSerifCJKsc-SemiBold.subset.woff2); font-weight: 600; }
@font-face { font-family: "Mono"; src: url(FONTS/NotoSansMonoCJKsc-Regular.subset.woff2); }
:root { --paper:#f6f0e6; --paper2:#efe6d6; --ink:#2b2622; --ink2:#5d544b; --ink3:#8a7f73; --rule:#d9cdb9;
  --teal:#377b77; --copper:#b77830; --copper-deep:#8a5418; --purple:#785e91; --green:#5f7f3a; }
* { box-sizing:border-box; margin:0; padding:0; }
html, body { width:1080px; height:1920px; overflow:hidden; }
body { font-family:"Sans"; color:var(--ink);
  background: radial-gradient(1300px 1200px at 30% 15%, #fbf7f0 0%, var(--paper) 55%, var(--paper2) 100%); }
#head { position:absolute; left:84px; right:84px; top:84px; height:250px; }
.kicker { font-family:"Mono"; font-size:30px; letter-spacing:3px; color:var(--copper-deep); }
.era { position:absolute; left:0; top:54px; font-family:"Serif"; font-size:104px; line-height:1.15; }
.span { position:absolute; left:0; top:190px; font-family:"Mono"; font-size:28px; color:var(--ink3); }
#year { position:absolute; right:0; top:40px; font-family:"Serif"; font-size:132px; color:var(--copper); opacity:.9; text-align:right; }
#list { position:absolute; left:0; right:0; top:370px; height:1060px; overflow:hidden;
  -webkit-mask-image: linear-gradient(transparent 0, #000 70px, #000 960px, transparent 1060px); }
#track { position:absolute; left:0; right:0; top:0; }
#rail { position:absolute; left:232px; width:4px; background:var(--rule); border-radius:2px; }
.entry { position:absolute; left:40px; right:60px; display:grid; grid-template-columns:172px 60px 1fr;
  padding:18px 24px 20px 0; border-radius:24px; }
.entry .hl { position:absolute; left:200px; right:-20px; top:0; bottom:0; border-radius:24px;
  background:#fbf6ec; border:2px solid #e6d3b4; }
.yr { position:relative; font-family:"Mono"; font-size:36px; color:var(--ink2); text-align:right; padding-top:4px; white-space:nowrap; }
.yr.long { font-size:28px; padding-top:9px; }
.dot { position:relative; width:30px; height:30px; border-radius:50%; margin:10px 0 0 16px;
  background:var(--copper); border:6px solid var(--paper); box-shadow:0 0 0 3px var(--copper); }
.problem .dot { background:var(--purple); box-shadow:0 0 0 3px var(--purple); border-radius:5px; transform:rotate(45deg) scale(.88); }
.check .dot { background:var(--green); box-shadow:0 0 0 3px var(--green); border-radius:7px; }
.body { position:relative; }
.who { font-size:46px; font-weight:700; color:var(--teal); line-height:1.25; }
.what { font-size:37px; line-height:1.5; margin-top:4px; }
.status { display:flex; flex-direction:column; gap:12px; margin-top:16px; }
.status span { font-size:29px; line-height:1.45; padding:12px 18px; border-radius:14px; }
.status .yes { background:#e3ecdc; color:#2f4a1c; }
.status .wait { background:#ece4f2; color:#47325e; }
#legend { position:absolute; left:84px; top:1442px; display:flex; gap:30px; font-size:25px; color:var(--ink3); }
.k::before { content:""; display:inline-block; width:18px; height:18px; margin-right:10px; vertical-align:-2px; border-radius:50%; background:var(--copper); }
.k.problem::before { background:var(--purple); border-radius:3px; transform:rotate(45deg) scale(.85); }
.k.check::before { background:var(--green); border-radius:4px; }
#cap { position:absolute; left:60px; right:60px; top:1500px; height:340px; background:#fbf8f2; border:2px solid var(--rule);
  border-radius:30px; padding:34px 40px; }
.capk { font-family:"Mono"; font-size:26px; color:var(--copper-deep); letter-spacing:2px; }
.capt { font-family:"Serif"; font-size:50px; margin-top:6px; }
.capn { font-size:31px; line-height:1.6; color:var(--ink2); margin-top:12px; }
#bar { position:absolute; left:60px; right:60px; top:1868px; height:6px; background:var(--rule); border-radius:3px; }
#fill { height:6px; background:var(--copper); border-radius:3px; width:0; }
</style></head><body>
<div id="head"><div class="kicker">黎曼猜想 · 时间线</div>
  <div class="era" id="eraA"></div><div class="era" id="eraB"></div>
  <div class="span" id="spanA"></div><div class="span" id="spanB"></div><div id="year"></div></div>
<div id="list"><div id="track"><div id="rail"></div></div></div>
<div id="legend"><span class="k">成果</span><span class="k problem">问题与事件</span><span class="k check">数值验证</span></div>
<div id="cap"><div class="capk" id="capk"></div><div class="capt" id="capt"></div><div class="capn" id="capn"></div></div>
<div id="bar"><div id="fill"></div></div>
<script>
const D = DATA;
const GAP = 22, VIEW = 1060, FOCUS = 0.68;
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2; };
const track = document.getElementById('track');
const els = D.entries.map((e) => {
  const div = document.createElement('div');
  div.className = 'entry ' + e.kind;
  div.innerHTML = `<div class="hl"></div><div class="yr${e.year.length > 6 ? ' long' : ''}">${e.year}</div><div class="dot"></div>` +
    `<div class="body"><div class="who">${e.who}</div><div class="what">${e.what}</div>${e.extra}</div>`;
  track.appendChild(div); return div;
});
let H = [];
function measure() { H = els.map((el) => el.offsetHeight + GAP); }
const chapterAt = (t) => { let i = 0; D.chapters.forEach((c, k) => { if (t >= c.start) i = k; }); return i; };
const grow = (e, t) => ease((t - e.at) / 0.6);
function layout(t) { const y = []; let acc = 0; D.entries.forEach((e, i) => { y.push(acc); acc += H[i] * grow(e, t); }); return { y, total: acc }; }
// Focus events: each appearance moves the view to that entry, measured once it has fully grown.
const order = D.entries.map((e, i) => i).sort((a, b) => D.entries[a].at - D.entries[b].at);
let targets = [];
function planScroll() {
  targets = order.map((i) => { const e = D.entries[i]; const L = layout(e.at + 0.7);
    return { at: e.at, y: Math.max(0, L.y[i] + H[i] / 2 - VIEW * FOCUS) }; });
}
function scrollAt(t) {
  let prev = 0, cur = null;
  for (const s of targets) { if (s.at <= t) { prev = cur ? cur.y : 0; cur = s; } }
  if (!cur) return 0;
  return prev + (cur.y - prev) * ease((t - cur.at) / 1.0);
}
function setText(id, s) { const el = document.getElementById(id); if (el.innerHTML !== s) el.innerHTML = s; }
window.setTime = function (t) {
  const ci = chapterAt(t), c = D.chapters[ci], last = ci === D.chapters.length - 1;
  const L = layout(t);
  let scroll = scrollAt(t);
  if (last) { // recap: sweep from the top of the timeline to its end
    const p = ease((t - c.start - 0.3) / (c.dur - 1.5));
    const from = scrollAt(c.start), end = Math.max(0, L.total - VIEW * 0.75);
    scroll = p < 0.12 ? from + (0 - from) * ease(p / 0.12) : end * ease((p - 0.12) / 0.88);
  }
  track.style.transform = `translateY(${(-scroll).toFixed(1)}px)`;
  const rail = document.getElementById('rail'); rail.style.top = '30px'; rail.style.height = Math.max(0, L.total - 40) + 'px';
  let focusYear = null, best = 1e9;
  D.entries.forEach((e, i) => {
    const el = els[i], g = grow(e, t), appear = clamp((t - e.at - 0.15) / 0.6);
    el.style.top = L.y[i] + 'px';
    let op = appear, hl = 0;
    if (appear > 0) {
      if (last) {
        const mid = L.y[i] + H[i] / 2 - scroll, d = Math.abs(mid - VIEW * 0.45);
        hl = clamp(1 - d / 160); op = 0.45 + 0.55 * clamp(1 - d / 420);
        if (d < best) { best = d; focusYear = e.year; }
      } else if (e.ch === ci) { hl = appear; }
      else { const since = t - D.chapters[e.ch + 1].start; op = appear * (1 - 0.58 * ease(since / 0.6)); }
    }
    el.style.opacity = op.toFixed(3);
    el.style.transform = `translateX(${((1 - ease(appear)) * 40).toFixed(1)}px)`;
    el.style.visibility = g > 0 || appear > 0 ? 'visible' : 'hidden';
    el.firstChild.style.opacity = hl.toFixed(3);
    if (!last && e.ch === ci && appear > 0) focusYear = e.year;
  });
  // Header: era crossfade, current year.
  const prevEra = ci ? D.chapters[ci - 1].era : c.era, k = ease((t - c.start) / 0.6);
  setText('eraA', c.era); setText('spanA', c.span); setText('eraB', prevEra); setText('spanB', ci ? D.chapters[ci - 1].span : c.span);
  const same = prevEra === c.era;
  document.getElementById('eraA').style.opacity = same ? 1 : k; document.getElementById('spanA').style.opacity = same ? 1 : k;
  document.getElementById('eraB').style.opacity = same ? 0 : 1 - k; document.getElementById('spanB').style.opacity = same ? 0 : 1 - k;
  setText('year', focusYear ? focusYear.split('/').pop().trim().split('-')[0] : '');
  // Caption: fade between chapters.
  const fade = Math.min(clamp((t - c.start) / 0.4), last ? 1 : clamp((c.start + c.dur - t) / 0.35));
  setText('capk', `第 ${ci + 1} 章 / ${D.chapters.length}`); setText('capt', c.title); setText('capn', c.narration);
  document.getElementById('cap').style.opacity = (0.15 + 0.85 * fade).toFixed(3);
  for (const id of ['capk', 'capt', 'capn']) document.getElementById(id).style.opacity = fade.toFixed(3);
  document.getElementById('fill').style.width = (100 * t / D.total).toFixed(2) + '%';
};
window.ready = document.fonts.ready.then(() => { measure(); planScroll(); window.setTime(0); return D.total; });
</script></body></html>'''


def main():
    html = PAGE.replace("FONTS", FONTS).replace("DATA", json.dumps(data(), ensure_ascii=False))
    (HERE / "film.html").write_text(html)
    d = data()
    print("film.html:", len(d["chapters"]), "chapters,", len(d["entries"]), "entries,", d["total"], "s")


if __name__ == "__main__":
    main()
