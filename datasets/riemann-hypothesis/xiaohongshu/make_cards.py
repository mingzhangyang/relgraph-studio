"""Build the Xiaohongshu image cards (1080 x 1440, 3:4) as one HTML page.

    python3 datasets/riemann-hypothesis/xiaohongshu/make_cards.py
    node datasets/riemann-hypothesis/xiaohongshu/shoot.mjs

The first command writes cards.html next to this file; the second screenshots each
card to 01-cover.png ... with the repository's vendored Noto CJK fonts.
"""

import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = "../../../packages/render/fonts"

# First ten nontrivial zeros, imaginary parts (standard tables, e.g. Odlyzko).
ZEROS = [14.134725, 21.022040, 25.010858, 30.424876, 32.935062,
         37.586178, 40.918719, 43.327073, 48.005151, 49.773832]


def theta(t):
    return t / 2 * math.log(t / (2 * math.pi)) - t / 2 - math.pi / 8 + 1 / (48 * t) + 7 / (5760 * t ** 3)


def hardy_z(t):
    """Riemann–Siegel formula with the first correction term (plenty for a drawing)."""
    a = math.sqrt(t / (2 * math.pi))
    n_max = int(a)
    th = theta(t)
    s = sum(math.cos(th - t * math.log(n)) / math.sqrt(n) for n in range(1, n_max + 1))
    p = a - n_max
    if abs(math.cos(2 * math.pi * p)) < 1e-6:
        p += 1e-5
    c0 = math.cos(2 * math.pi * (p * p - p - 1 / 16)) / math.cos(2 * math.pi * p)
    return 2 * s + (-1) ** (n_max - 1) * (t / (2 * math.pi)) ** -0.25 * c0


def z_path(x0, y0, w, h, t0=8.0, t1=50.5, scale=None):
    ts = [t0 + (t1 - t0) * i / 900 for i in range(901)]
    zs = [hardy_z(t) for t in ts]
    scale = scale or (h / 2) / max(abs(z) for z in zs)
    pts = [(x0 + (t - t0) / (t1 - t0) * w, y0 - z * scale) for t, z in zip(ts, zs)]
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    dots = [(x0 + (z - t0) / (t1 - t0) * w, y0) for z in ZEROS if t0 <= z <= t1]
    return d, dots


def cover_svg():
    d, dots = z_path(60, 260, 960, 380)
    circles = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" class="zero"/>' for x, y in dots)
    return f'''<svg viewBox="0 0 1080 520" class="zplot">
  <line x1="40" y1="260" x2="1040" y2="260" class="axis"/>
  <path d="{d}" class="zcurve"/>
  {circles}
  <text x="60" y="505" class="cap">Z(t)：ζ 函数沿临界线 Re(s)=½ 的实值形式。每次穿过横轴，就是一个零点。</text>
</svg>'''


def strip_svg():
    # Critical strip: 0 < Re(s) < 1, critical line at 1/2, zeros at their heights.
    x0, x1, xm = 330, 750, 540
    top, bottom = 40, 700
    def y(t):
        return bottom - (t / 52) * (bottom - top)
    dots = "".join(f'<circle cx="{xm}" cy="{y(z):.1f}" r="8" class="zero"/>' for z in ZEROS)
    labels = "".join(
        f'<text x="{xm + 22}" y="{y(z) + 7:.1f}" class="tick">{z:.2f}</text>' for z in ZEROS[:3])
    return f'''<svg viewBox="0 0 1080 760" class="strip" style="height:600px">
  <rect x="{x0}" y="{top}" width="{x1 - x0}" height="{bottom - top}" class="band"/>
  <line x1="{x0}" y1="{top}" x2="{x0}" y2="{bottom}" class="edge"/>
  <line x1="{x1}" y1="{top}" x2="{x1}" y2="{bottom}" class="edge"/>
  <line x1="{xm}" y1="{top}" x2="{xm}" y2="{bottom}" class="crit"/>
  <line x1="120" y1="{bottom}" x2="960" y2="{bottom}" class="axis"/>
  {dots}{labels}
  <text x="{x0}" y="{bottom + 42}" class="tick" text-anchor="middle">0</text>
  <text x="{xm}" y="{bottom + 42}" class="tick strong" text-anchor="middle">½</text>
  <text x="{x1}" y="{bottom + 42}" class="tick" text-anchor="middle">1</text>
  <text x="{x0 - 24}" y="{(top + bottom) / 2 + 10}" class="note" text-anchor="end">临界带</text>
  <text x="{x1 + 24}" y="{top + 30}" class="note">零点高度 t</text>
  <text x="{xm}" y="{top - 8}" class="note strong" text-anchor="middle">临界线 Re(s) = ½</text>
</svg>'''


# Proven proportion of nontrivial zeros on the critical line (lower bounds).
RECORDS = [
    ("1942", "塞尔伯格", None, "正比例"),
    ("1974", "莱文森", 34.74, "> 1/3"),
    ("1989", "康雷", 40.88, "> 2/5"),
    ("2011", "布伊、康雷、扬", 41.05, ""),
    ("2020", "普拉特等四人", 41.73, "> 5/12"),
    ("2026", "Claude 等", 67.25, ""),
]


def bars_html():
    rows = []
    for year, who, pct, note in RECORDS:
        latest = year == "2026"
        width = 2 if pct is None else pct
        value = "> 0%" if pct is None else f"{pct:.2f}%"
        rows.append(f'''<div class="bar-row{' latest' if latest else ''}">
  <div class="bar-label"><b>{year}</b><span>{who}</span></div>
  <div class="bar-track"><div class="bar" style="width:{width}%"></div>
    <div class="bar-value" style="left:calc({width}% + 14px)">{value}<em>{note}</em></div></div>
</div>''')
    return "\n".join(rows)


TIMELINE = [
    ("起源", "1737 — 1903", [
        ("1737", "欧拉", "欧拉乘积：正整数倒数幂之和等于按素数构造的无穷乘积（Re(s)&gt;1）", "result"),
        ("1798", "高斯 · 勒让德", "猜测 x 以内约有 x / ln x 个素数", "problem"),
        ("1837", "狄利克雷", "L 函数：等差数列中有无穷多素数", "result"),
        ("1859", "黎曼", "8 页论文：ζ 函数延拓到复平面，写下“很可能所有零点都在 Re(s)=½”", "problem"),
        ("1896", "阿达马 · 德拉瓦莱普桑", "证明素数定理：关键是 Re(s)=1 上没有零点", "result"),
        ("1900", "希尔伯特", "列为 23 个问题中的第 8 个", "problem"),
        ("1903", "格拉姆", "手算前 15 个零点，全在临界线上", "check"),
    ]),
    ("二十世纪", "1914 — 1987", [
        ("1914", "哈代", "临界线上有无穷多个零点", "result"),
        ("1914", "李特尔伍德", "π(x) 与 li(x) 的大小关系会无穷多次反转", "result"),
        ("1932", "西格尔", "在黎曼遗稿中发现高效计算零点的公式", "result"),
        ("1942", "塞尔伯格", "临界线上的零点占一个正比例", "result"),
        ("1948 / 1974", "韦伊 · 德利涅", "有限域上的“黎曼猜想”被完全证明", "result"),
        ("1953", "图灵", "第一次用电子计算机检查零点", "check"),
        ("1973", "蒙哥马利 · 戴森", "茶歇对话：零点间距像随机矩阵的本征值", "result"),
        ("1987", "奥德利兹科", "研究第 10<sup>12</sup> 个零点后的 10 万个零点，间距统计与预测吻合良好", "check"),
    ]),
    ("逼近", "2000 — 2024", [
        ("2000", "克雷数学研究所", "千禧年大奖难题，奖金 100 万美元", "problem"),
        ("2018", "罗杰斯 · 陶哲轩", "证明 Λ ≥ 0：若猜想成立，便是“刚好成立”", "result"),
        ("2018", "阿蒂亚", "宣布证明，未被数学界接受", "problem"),
        ("2020", "普拉特等四人", "临界线上零点比例 > 5/12（约 41.7%）", "result"),
        ("2021", "普拉特 · 特鲁吉安", "严格验证前约 12.4 万亿个零点", "check"),
        ("2024", "古思 · 梅纳德", "首次整体改进英厄姆 1940 年的零点密度界", "result"),
    ]),
]


def timeline_card(idx, title, span, items, page):
    lis = "".join(
        f'''<li class="{kind}"><div class="yr">{yr}</div><div class="dot"></div>
<div class="body"><div class="who">{who}</div><div class="what">{what}</div></div></li>'''
        for yr, who, what, kind in items)
    return f'''<section class="card tl">
  <div class="kicker">时间线 {idx}/3 · {span}</div>
  <h2>{title}</h2>
  <ul class="timeline">{lis}</ul>
  <div class="legend"><span class="k result">成果</span><span class="k problem">问题与事件</span><span class="k check">数值验证</span></div>
  <div class="page">{page}</div>
</section>'''


PEOPLE = [
    ("欧拉", "1707–1783", "欧拉乘积"), ("高斯", "1777–1855", "素数计数猜想"),
    ("黎曼", "1826–1866", "提出猜想"), ("希尔伯特", "1862–1943", "第八问题"),
    ("哈代", "1877–1947", "无穷多零点"), ("西格尔", "1896–1981", "整理黎曼遗稿"),
    ("塞尔伯格", "1917–2007", "正比例零点"), ("图灵", "1912–1954", "机器算零点"),
    ("韦伊", "1906–1998", "有限域版本"), ("蒙哥马利", "1944 年生", "对关联猜想"),
    ("戴森", "1923–2020", "随机矩阵联系"), ("陶哲轩", "1975 年生", "Λ ≥ 0"),
]


def people_html():
    return "".join(
        f'<div class="person"><div class="pn">{n}</div><div class="py">{y}</div><div class="pw">{w}</div></div>'
        for n, y, w in PEOPLE)


CSS = f'''
@font-face {{ font-family: "Sans"; src: url({FONTS}/NotoSansCJKsc-Regular.subset.woff2); font-weight: 400; }}
@font-face {{ font-family: "Sans"; src: url({FONTS}/NotoSansCJKsc-Medium.subset.woff2); font-weight: 500; }}
@font-face {{ font-family: "Sans"; src: url({FONTS}/NotoSansCJKsc-Bold.subset.woff2); font-weight: 700; }}
@font-face {{ font-family: "Serif"; src: url({FONTS}/NotoSerifCJKsc-SemiBold.subset.woff2); font-weight: 600; }}
@font-face {{ font-family: "Mono"; src: url({FONTS}/NotoSansMonoCJKsc-Regular.subset.woff2); }}
:root {{
  --paper: #f6f0e6; --paper2: #efe6d6; --ink: #2b2622; --ink2: #5d544b; --ink3: #8a7f73;
  --rule: #d9cdb9; --teal: #377b77; --copper: #b77830; --copper-deep: #8a5418;
  --purple: #785e91; --blue: #3f62a8; --green: #5f7f3a;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: #ccc; font-family: "Sans"; color: var(--ink); }}
.card {{ width: 1080px; height: 1440px; position: relative; overflow: hidden; margin: 0 0 40px;
  background: radial-gradient(1200px 900px at 30% 20%, #fbf7f0 0%, var(--paper) 55%, var(--paper2) 100%);
  padding: 96px 84px; }}
.kicker {{ font-family: "Mono"; font-size: 26px; letter-spacing: 3px; color: var(--copper-deep); text-transform: uppercase; }}
h1 {{ font-family: "Serif"; font-weight: 600; font-size: 108px; line-height: 1.12; margin-top: 28px; letter-spacing: -1px; }}
h2 {{ font-family: "Serif"; font-weight: 600; font-size: 72px; line-height: 1.2; margin-top: 18px; }}
.lead {{ font-size: 38px; line-height: 1.6; color: var(--ink2); margin-top: 28px; }}
.page {{ position: absolute; right: 84px; bottom: 60px; font-family: "Mono"; font-size: 24px; color: var(--ink3); }}
.foot {{ position: absolute; left: 84px; bottom: 60px; font-size: 24px; color: var(--ink3); }}
mark {{ background: linear-gradient(transparent 58%, #ecd3ad 58%); color: inherit; padding: 0 4px; }}

/* cover */
.cover h1 {{ font-size: 124px; }}
.cover .q {{ font-family: "Serif"; font-size: 84px; color: var(--copper-deep); margin-top: 8px; }}
.zplot {{ width: 1080px; margin: 70px -84px 0; display: block; }}
.zplot .axis {{ stroke: var(--rule); stroke-width: 3; }}
.zplot .zcurve {{ fill: none; stroke: var(--teal); stroke-width: 5; stroke-linejoin: round; }}
.zplot .zero, .strip .zero {{ fill: var(--copper); stroke: var(--paper); stroke-width: 4; }}
.zplot .cap {{ font-size: 25px; fill: var(--ink3); }}
.tags {{ display: flex; gap: 18px; flex-wrap: wrap; margin-top: 40px; }}
.tag {{ font-size: 30px; padding: 12px 26px; border-radius: 999px; border: 2px solid var(--rule); color: var(--ink2); background: #fbf8f2; }}
.tag.on {{ background: var(--ink); color: var(--paper); border-color: var(--ink); }}

/* explainer */
.strip {{ width: 1080px; margin: 10px -84px 0; display: block; }}
.strip .band {{ fill: #eadfcb; }}
.strip .edge {{ stroke: var(--rule); stroke-width: 2; stroke-dasharray: 8 8; }}
.strip .crit {{ stroke: var(--purple); stroke-width: 4; }}
.strip .axis {{ stroke: var(--ink3); stroke-width: 2; }}
.strip .tick {{ font-family: "Mono"; font-size: 26px; fill: var(--ink3); }}
.strip .note {{ font-size: 28px; fill: var(--ink2); }}
.strip .strong {{ fill: var(--purple); font-weight: 700; }}
.facts {{ display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 6px; }}
.fact {{ background: #fbf8f2; border: 2px solid var(--rule); border-radius: 22px; padding: 26px 28px; }}
.fact b {{ display: block; font-size: 30px; color: var(--ink); margin-bottom: 8px; }}
.fact span {{ font-size: 27px; line-height: 1.55; color: var(--ink2); }}

/* timeline */
.timeline {{ list-style: none; margin-top: 56px; position: relative; height: 1010px; display: flex; flex-direction: column; justify-content: space-between; }}
.timeline::before {{ content: ""; position: absolute; left: 212px; top: 14px; bottom: 14px; width: 4px; background: var(--rule); border-radius: 2px; }}
.timeline li {{ display: grid; grid-template-columns: 190px 48px 1fr; align-items: start; }}
.yr {{ font-family: "Mono"; font-size: 30px; color: var(--ink2); text-align: right; padding-top: 6px; white-space: nowrap; }}
.dot {{ width: 26px; height: 26px; border-radius: 50%; margin: 10px 0 0 13px; background: var(--copper); border: 5px solid var(--paper); box-shadow: 0 0 0 2px var(--copper); }}
li.problem .dot {{ background: var(--purple); box-shadow: 0 0 0 2px var(--purple); border-radius: 4px; transform: rotate(45deg) scale(.9); }}
li.check .dot {{ background: var(--green); box-shadow: 0 0 0 2px var(--green); border-radius: 6px; }}
.who {{ font-size: 38px; font-weight: 700; color: var(--teal); }}
.what {{ font-size: 32px; line-height: 1.5; color: var(--ink); margin-top: 2px; }}
.legend {{ position: absolute; left: 84px; bottom: 60px; display: flex; gap: 28px; font-size: 24px; color: var(--ink3); }}
.k::before {{ content: ""; display: inline-block; width: 18px; height: 18px; margin-right: 10px; vertical-align: -2px; border-radius: 50%; background: var(--copper); }}
.k.problem::before {{ background: var(--purple); border-radius: 3px; transform: rotate(45deg) scale(.85); }}
.k.check::before {{ background: var(--green); border-radius: 4px; }}

/* chart */
.chart {{ margin-top: 80px; }}
.bar-row {{ display: grid; grid-template-columns: 230px 1fr; align-items: center; margin-bottom: 54px; }}
.bar-label b {{ display: block; font-family: "Mono"; font-size: 34px; font-weight: 400; color: var(--ink); }}
.bar-label span {{ font-size: 24px; color: var(--ink3); }}
.bar-track {{ position: relative; height: 56px; border-left: 3px solid var(--ink3); }}
.bar {{ height: 56px; background: #d7a66a; border-radius: 0 8px 8px 0; }}
.latest .bar {{ background: var(--copper-deep); }}
.bar-value {{ position: absolute; top: 4px; font-family: "Mono"; font-size: 34px; color: var(--ink); white-space: nowrap; }}
.bar-value em {{ font-style: normal; font-family: "Sans"; font-size: 24px; color: var(--ink3); margin-left: 12px; }}
.latest .bar-value {{ font-weight: 700; }}
.gridline {{ position: absolute; top: -12px; bottom: -12px; border-left: 2px dashed var(--rule); }}
.chart-note {{ font-size: 27px; line-height: 1.6; color: var(--ink2); margin-top: 26px; background: #fbf8f2; border-left: 6px solid var(--copper); padding: 22px 28px; border-radius: 0 16px 16px 0; }}

/* 2026 */
.event {{ margin-top: 44px; background: #fbf8f2; border: 2px solid var(--rule); border-radius: 28px; padding: 38px 40px; }}
.event .when {{ font-family: "Mono"; font-size: 28px; color: var(--copper-deep); }}
.event h3 {{ font-family: "Serif"; font-size: 50px; margin: 10px 0 14px; }}
.event p {{ font-size: 30px; line-height: 1.6; color: var(--ink2); }}
.status {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 26px; }}
.status div {{ border-radius: 18px; padding: 20px 24px; font-size: 27px; line-height: 1.5; }}
.status .yes {{ background: #e3ecdc; color: #2f4a1c; }}
.status .wait {{ background: #ece4f2; color: #47325e; }}
.status b {{ display: block; font-size: 26px; margin-bottom: 6px; }}

/* people */
.people {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 56px; }}
.person {{ background: #fbf8f2; border: 2px solid var(--rule); border-radius: 24px; padding: 28px 26px; }}
.pn {{ font-family: "Serif"; font-size: 46px; color: var(--teal); }}
.py {{ font-family: "Mono"; font-size: 23px; color: var(--ink3); margin-top: 4px; }}
.pw {{ font-size: 29px; margin-top: 14px; color: var(--ink); }}

/* end */
.end .big {{ font-family: "Serif"; font-size: 64px; line-height: 1.45; margin-top: 70px; }}
.src {{ margin-top: 60px; font-size: 25px; line-height: 1.75; color: var(--ink2); }}
.src b {{ color: var(--ink); }}
'''


def build():
    cards = []
    cards.append(f'''<section class="card cover" id="c01">
  <div class="kicker">1859 → 2026 · 数学史时间线</div>
  <h1>黎曼猜想<br>167 年</h1>
  <div class="q">今年，它被证明了吗？</div>
  {cover_svg()}
  <div class="tags"><span class="tag on">竖屏视频 3′53″</span><span class="tag">66 个节点</span><span class="tag">2026 最新进展</span></div>
  <div class="foot">从欧拉乘积到机器检查的证明</div>
</section>''')
    cards.append(f'''<section class="card" id="c02">
  <div class="kicker">一分钟看懂</div>
  <h2>它到底在猜什么？</h2>
  <p class="lead">ζ(s) = 1 + 1/2<sup>s</sup> + 1/3<sup>s</sup> + …　黎曼猜想说：它的<mark>非平凡零点全部落在 Re(s) = ½ 这条直线上</mark>。</p>
  {strip_svg()}
  <div class="facts">
    <div class="fact"><b>为什么重要</b><span>零点控制素数分布的“误差”。猜想成立，素数个数与估计值的偏差就不超过约 √x · ln x。</span></div>
    <div class="fact"><b>已经算了多少</b><span>前约 12.4 万亿个零点已被严格验证，全部在线上（2021）。但“算得多”不等于证明。</span></div>
  </div>
  <div class="page">2 / 9</div>
</section>''')
    for i, (title, span, items) in enumerate(TIMELINE, 1):
        cards.append(timeline_card(i, title, span, items, f"{i + 2} / 9").replace(
            '<section class="card tl">', f'<section class="card tl{" dense" if len(items) > 7 else ""}" id="c0{i + 2}">'))
    cards.append(f'''<section class="card" id="c06">
  <div class="kicker">比例接力</div>
  <h2>临界线上的零点，<br>证明到了多少？</h2>
  <div class="chart">{bars_html()}</div>
  <div class="chart-note">每一条都是“至少”的下界。2026 年的数字要求更严：零点既在临界线上，又是单零点。要证明黎曼猜想，这个比例必须是 100%。</div>
  <div class="page">6 / 9</div>
</section>''')
    cards.append('''<section class="card" id="c07">
  <div class="kicker">2026 · 两件大事</div>
  <h2>今年发生了什么？</h2>
  <div class="event">
    <div class="when">2026 年 8—9 月</div>
    <h3>越过三分之二</h3>
    <p>Anthropic 内部研究版的 Claude 给出证明：<mark>超过 67.25%</mark> 的非平凡零点是单零点且在临界线上；数学家阿尔珀格与弗曼核验。拉姆祖里随后用一个希尔伯特空间不等式给出更短的新证明。</p>
  </div>
  <div class="event">
    <div class="when">2026 年 11 月 20—21 日</div>
    <h3>一份 1700 万行的 Lean 证明</h3>
    <p>阿尔珀格发布 Lean 证明库，声称证明黎曼猜想。Lean FRO 与 Mathlib Initiative 发表联合声明。</p>
    <div class="status">
      <div class="yes"><b>已确认</b>陈述就是 Mathlib 中的黎曼猜想；代码可编译，并通过内核与独立检查器</div>
      <div class="wait"><b>仍在进行</b>数学家读懂并审阅证明中的思想；尚无同行评议的论文</div>
    </div>
  </div>
  <div class="page">7 / 9</div>
</section>''')
    cards.append(f'''<section class="card" id="c08">
  <div class="kicker">人物速查</div>
  <h2>12 位关键人物</h2>
  <div class="people">{people_html()}</div>
  <div class="page">8 / 9</div>
</section>''')
    cards.append('''<section class="card end" id="c09">
  <div class="kicker">写在最后</div>
  <h2>从一句“很可能”<br>到机器检查的证明</h2>
  <p class="big">1859 年，黎曼在论文里写下<br><mark>es ist sehr wahrscheinlich</mark><br>——“很可能”。</p>
  <p class="lead">167 年后，计算机替我们检查了每一步推理；而理解它，仍是人的工作。</p>
  <div class="src"><b>主要资料</b><br>Riemann 1859 · Hardy 1914 · Selberg 1942 · Levinson 1974 · Conrey 1989<br>Platt & Trudgian, Bull. LMS 2021 · Guth & Maynard, arXiv:2405.20552<br>Lamzouri, arXiv:2609.02882 · Lean FRO & Mathlib Initiative 联合声明（2026-11-21）</div>
  <div class="page">9 / 9</div>
</section>''')
    html = f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{"".join(cards)}</body></html>'
    (HERE / "cards.html").write_text(html)
    print("cards.html with", len(cards), "cards")


if __name__ == "__main__":
    build()
