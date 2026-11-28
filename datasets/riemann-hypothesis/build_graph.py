"""Generate the Riemann Hypothesis timeline graph and its vertical Studio project.

Run from the repository root, then format the output with Prettier:
    python3 datasets/riemann-hypothesis/build_graph.py
    npx prettier --write datasets/riemann-hypothesis/*.json
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

KINDS = {
    "人物": {"label": "人物", "color": "#377b77", "shape": "capsule"},
    "研究团队": {"label": "研究团队与 AI", "color": "#3f62a8", "shape": "capsule"},
    "理论与成果": {"label": "理论与成果", "color": "#b77830", "shape": "box"},
    "数值验证": {"label": "数值验证", "color": "#5f7f3a", "shape": "box"},
    "问题与事件": {"label": "问题与事件", "color": "#785e91", "shape": "decision"},
}

# People: lifetime spans. Living people have no end (the bar runs to the axis end).
PEOPLE = [
    ("欧拉", 1707, 1783, 1737),
    ("勒让德", 1752, 1833, 1798),
    ("高斯", 1777, 1855, 1798),
    ("狄利克雷", 1805, 1859, 1837),
    ("切比雪夫", 1821, 1894, 1850),
    ("黎曼", 1826, 1866, 1859),
    ("冯·曼戈尔特", 1854, 1925, 1895),
    ("阿达马", 1865, 1963, 1896),
    ("德拉瓦莱普桑", 1866, 1962, 1896),
    ("希尔伯特", 1862, 1943, 1900),
    ("格拉姆", 1850, 1916, 1903),
    ("哈代", 1877, 1947, 1914),
    ("李特尔伍德", 1885, 1977, 1914),
    ("西格尔", 1896, 1981, 1932),
    ("英厄姆", 1900, 1967, 1940),
    ("塞尔伯格", 1917, 2007, 1942),
    ("韦伊", 1906, 1998, 1948),
    ("图灵", 1912, 1954, 1953),
    ("蒙哥马利", 1944, None, 1973),
    ("戴森", 1923, 2020, 1973),
    ("莱文森", 1912, 1975, 1974),
    ("德利涅", 1944, None, 1974),
    ("奥德利兹科", 1949, None, 1987),
    ("康雷", 1955, None, 1989),
    ("孔涅", 1947, None, 1999),
    ("拉姆祖里", None, None, 2026),
]

TEAMS = [
    ("罗杰斯与陶哲轩", 2018, "布拉德·罗杰斯与陶哲轩（1975 年生）。"),
    ("Polymath15 合作", 2019, None),
    ("普拉特等四人", 2020, "普拉特、罗夫莱斯、扎哈雷斯库、蔡恩德勒"),
    ("普拉特与特鲁吉安", 2021, None),
    ("古思与梅纳德", 2024, None),
    ("Claude 研究版", 2026, "Anthropic 内部研究版本的 Claude 模型。"),
    ("阿尔珀格", 2026, "Anthropic 数学家。2026 年 8 月与弗曼核验 Claude 的证明；11 月发布 Lean 证明库。"),
    ("Lean 社区", 2026, "Lean FRO 与 Mathlib Initiative。"),
]

# (id, kind, year, summary, evidence)
RESULTS = [
    ("欧拉乘积公式", "理论与成果", 1737,
     "对所有素数 p 的乘积 ∏(1-p^-s)^-1 等于对所有正整数 n 的和 Σ n^-s。素数第一次与一个解析函数绑在一起。",
     ["Euler, Variae observationes circa series infinitas (1737/1744)"]),
    ("素数定理猜想", "问题与事件", 1798,
     "高斯少年时估计 x 以内的素数约有 x/ln x 个（后改用对数积分 li(x)）；勒让德 1798 年发表了类似的经验公式。",
     ["Legendre, Essai sur la théorie des nombres (1798)", "Gauss, letter to Encke (1849)"]),
    ("狄利克雷 L 函数", "理论与成果", 1837,
     "狄利克雷用带特征的级数证明：首项与公差互素的等差数列中有无穷多个素数。",
     ["Dirichlet, Beweis des Satzes … (1837)"]),
    ("切比雪夫估计", "理论与成果", 1850,
     "切比雪夫证明 π(x) 与 x/ln x 之比被夹在两个常数之间，为素数定理迈出第一步。",
     ["Chebyshev, Mémoire sur les nombres premiers (1850/1852)"]),
    ("ζ 函数的解析延拓", "理论与成果", 1859,
     "黎曼把 ζ(s) 延拓到整个复平面（s=1 除外），并给出联系 s 与 1-s 的函数方程。",
     ["Riemann, Über die Anzahl der Primzahlen unter einer gegebenen Grösse (1859)"]),
    ("素数的显式公式", "理论与成果", 1859,
     "素数计数可以写成主项减去对 ζ 的全部非平凡零点求和。零点的位置控制着素数分布的误差。",
     ["Riemann (1859)", "von Mangoldt (1895)"]),
    ("黎曼猜想", "问题与事件", 1859,
     "ζ(s) 的所有非平凡零点的实部都等于 1/2，即都落在“临界线”上。",
     [{"cite": "Riemann (1859)", "quote": "es ist sehr wahrscheinlich, dass alle Wurzeln reell sind.",
       "locator": "Monatsberichte der Berliner Akademie, 1859",
       "url": "https://www.claymath.org/wp-content/uploads/2023/04/Wilkins-translation.pdf"}]),
    ("零点计数公式", "理论与成果", 1905,
     "高度 T 以下的非平凡零点约有 (T/2π)·ln(T/2πe) 个。黎曼给出陈述，冯·曼戈尔特于 1905 年完成证明。",
     ["von Mangoldt, Zur Verteilung der Nullstellen … (1905)"]),
    ("素数定理", "理论与成果", 1896,
     "阿达马与德拉瓦莱普桑各自证明 π(x) ~ x/ln x。关键一步是 ζ(s) 在直线 Re(s)=1 上没有零点。",
     ["Hadamard (1896)", "de la Vallée Poussin (1896)"]),
    ("希尔伯特第八问题", "问题与事件", 1900,
     "1900 年巴黎国际数学家大会，希尔伯特把黎曼猜想列入 23 个问题的第八个。",
     ["Hilbert, Mathematische Probleme (1900)"]),
    ("前 15 个零点", "数值验证", 1903,
     "格拉姆手算出前 15 个非平凡零点，全部在临界线上。",
     ["Gram, Acta Mathematica 27 (1903)"]),
    ("临界线上无穷多零点", "理论与成果", 1914,
     "哈代证明临界线上有无穷多个零点。这还不能说明“全部”，甚至不能说明“占一定比例”。",
     ["Hardy, Comptes Rendus 158 (1914)"]),
    ("π(x)-li(x) 变号", "理论与成果", 1914,
     "李特尔伍德证明 π(x)-li(x) 会无穷多次改变符号，推翻了“li(x) 总是高估”的数值印象。",
     ["Littlewood, Comptes Rendus 158 (1914)"]),
    ("黎曼–西格尔公式", "理论与成果", 1932,
     "西格尔在黎曼的遗稿中整理出一套高效计算 ζ 在临界线上取值的公式，说明黎曼曾亲手计算零点。",
     ["Siegel, Über Riemanns Nachlaß zur analytischen Zahlentheorie (1932)"]),
    ("零点密度估计", "理论与成果", 1940,
     "英厄姆给出偏离临界线的零点个数上界 N(σ,T)，这一指数此后八十多年未被整体改进。",
     ["Ingham, Quarterly J. Math. 11 (1940)"]),
    ("正比例零点在临界线上", "理论与成果", 1942,
     "塞尔伯格证明临界线上的零点占全部零点的一个正比例。",
     ["Selberg, Skr. Norske Vid. Akad. Oslo (1942)"]),
    ("有限域曲线上的黎曼猜想", "理论与成果", 1948,
     "韦伊证明有限域上代数曲线的 ζ 函数满足类比的黎曼猜想。这是“另一个世界”里的已解决版本。",
     ["Weil, Sur les courbes algébriques … (1948)"]),
    ("计算机算零点", "数值验证", 1953,
     "图灵设计检验方法，用曼彻斯特 Mark 1 计算机检查零点，开启机器验证时代。",
     ["Turing, Proc. London Math. Soc. (3) 3 (1953)"]),
    ("对关联猜想", "理论与成果", 1973,
     "蒙哥马利研究零点间距的统计。戴森在普林斯顿高等研究院茶歇时认出：它与随机厄米矩阵本征值的对关联相同。",
     ["Montgomery, Proc. Sympos. Pure Math. 24 (1973)"]),
    ("超过 1/3", "理论与成果", 1974,
     "莱文森证明超过 1/3 的非平凡零点在临界线上。",
     ["Levinson, Advances in Math. 13 (1974)"]),
    ("韦伊猜想", "理论与成果", 1974,
     "德利涅证明高维代数簇上的黎曼猜想类比，完成韦伊猜想的最后一步。",
     ["Deligne, Publ. Math. IHÉS 43 (1974)"]),
    ("零点间距与随机矩阵", "数值验证", 1987,
     "奥德利兹科在第 10 的 20 次方个零点附近计算大量零点，其间距分布与 GUE 随机矩阵预测高度吻合。",
     ["Odlyzko, Math. Comp. 48 (1987)"]),
    ("超过 2/5", "理论与成果", 1989,
     "康雷把临界线上零点的比例提高到 40% 以上。",
     ["Conrey, J. reine angew. Math. 399 (1989)"]),
    ("迹公式进路", "理论与成果", 1999,
     "孔涅用非交换几何把零点写成一种迹公式的谱，是“希尔伯特–波利亚”算子思路的代表方案之一。",
     ["Connes, Selecta Math. 5 (1999)"]),
    ("千禧年大奖难题", "问题与事件", 2000,
     "克雷数学研究所把黎曼猜想列为七个千禧年大奖难题之一，奖金 100 万美元。",
     ["Clay Mathematics Institute (2000)"]),
    ("德布鲁因–纽曼常数", "理论与成果", 2018,
     "黎曼猜想等价于 Λ ≤ 0。罗杰斯与陶哲轩证明 Λ ≥ 0；Polymath15 合作随后得到 Λ ≤ 0.22。",
     ["Rodgers & Tao, Forum Math. Pi 8 (2020)", "Polymath, Res. Math. Sci. 6 (2019)"]),
    ("阿蒂亚的宣称", "问题与事件", 2018,
     "菲尔兹奖得主阿蒂亚（1929–2019）在海德堡获奖者论坛宣布证明，论证未获数学界接受。",
     ["Heidelberg Laureate Forum (2018)"]),
    ("超过 5/12", "理论与成果", 2020,
     "普拉特、罗夫莱斯、扎哈雷斯库与蔡恩德勒把比例提高到 5/12（约 41.7%）以上。",
     ["Pratt, Robles, Zaharescu & Zeindler, Res. Math. Sci. 7 (2020)"]),
    ("验证到高度 3·10¹²", "数值验证", 2021,
     "普拉特与特鲁吉安用区间算术严格验证：高度 3·10¹² 以下的约 12.4 万亿个零点全部在临界线上，且都是单零点。",
     [{"cite": "Platt & Trudgian, Bull. London Math. Soc. 53 (2021)", "url": "https://arxiv.org/abs/2004.09765"}]),
    ("零点密度新界", "理论与成果", 2024,
     "古思与梅纳德给出狄利克雷多项式的新大值估计，首次整体改进英厄姆 1940 年的零点密度界。",
     [{"cite": "Guth & Maynard, arXiv:2405.20552 (2024); Annals of Math. 203 (2026)",
       "url": "https://arxiv.org/abs/2405.20552"}]),
    ("超过 2/3 且为单零点", "理论与成果", 2026,
     "Claude 研究版给出证明：超过 67.25% 的非平凡零点是单零点并在临界线上；阿尔珀格与弗曼核验。拉姆祖里随后发表更短的新证明。",
     [{"cite": "Lamzouri, arXiv:2609.02882 (2026)",
       "quote": "more than 67.25% of the non-trivial zeros of the Riemann zeta function are simple and on the critical line",
       "url": "https://arxiv.org/abs/2609.02882"}]),
    ("Lean 形式化证明", "理论与成果", 2026,
     "2026 年 11 月 20 日，阿尔珀格发布约 1700 万行的 Lean 证明库。Lean FRO 与 Mathlib Initiative 次日声明：定理陈述即 Mathlib 中的 RiemannHypothesis，代码可编译并通过内核检查。数学思想的人工审阅仍在进行。",
     [{"cite": "Lean FRO & Mathlib Initiative, joint statement (2026-11-21)",
       "quote": "We hereby certify that both the statement and the proof of the Riemann Hypothesis are correct.",
       "url": "https://leanprover-community.github.io/blog/posts/riemann-hypothesis/"}]),
]

# (source, target, label, year)
EDGES = [
    ("欧拉", "欧拉乘积公式", "发现", 1737),
    ("高斯", "素数定理猜想", "估计", 1798),
    ("勒让德", "素数定理猜想", "发表", 1798),
    ("狄利克雷", "狄利克雷 L 函数", "引入", 1837),
    ("欧拉乘积公式", "狄利克雷 L 函数", "推广为", 1837),
    ("切比雪夫", "切比雪夫估计", "证明", 1850),
    ("素数定理猜想", "切比雪夫估计", "推进", 1850),
    ("黎曼", "ζ 函数的解析延拓", "建立", 1859),
    ("欧拉乘积公式", "ζ 函数的解析延拓", "起点", 1859),
    ("黎曼", "素数的显式公式", "写出", 1859),
    ("黎曼", "黎曼猜想", "提出", 1859),
    ("ζ 函数的解析延拓", "黎曼猜想", "引出", 1859),
    ("冯·曼戈尔特", "素数的显式公式", "严格证明", 1895),
    ("冯·曼戈尔特", "零点计数公式", "证明", 1905),
    ("阿达马", "素数定理", "证明", 1896),
    ("德拉瓦莱普桑", "素数定理", "证明", 1896),
    ("素数的显式公式", "素数定理", "通向", 1896),
    ("希尔伯特", "希尔伯特第八问题", "列入", 1900),
    ("黎曼猜想", "希尔伯特第八问题", "成为", 1900),
    ("格拉姆", "前 15 个零点", "计算", 1903),
    ("哈代", "临界线上无穷多零点", "证明", 1914),
    ("李特尔伍德", "π(x)-li(x) 变号", "证明", 1914),
    ("哈代", "李特尔伍德", "合作", 1914),
    ("西格尔", "黎曼–西格尔公式", "整理", 1932),
    ("黎曼", "黎曼–西格尔公式", "遗稿", 1932),
    ("英厄姆", "零点密度估计", "证明", 1940),
    ("塞尔伯格", "正比例零点在临界线上", "证明", 1942),
    ("临界线上无穷多零点", "正比例零点在临界线上", "加强为", 1942),
    ("韦伊", "有限域曲线上的黎曼猜想", "证明", 1948),
    ("图灵", "计算机算零点", "设计", 1953),
    ("黎曼–西格尔公式", "计算机算零点", "用于", 1953),
    ("蒙哥马利", "对关联猜想", "提出", 1973),
    ("戴森", "对关联猜想", "认出随机矩阵", 1973),
    ("莱文森", "超过 1/3", "证明", 1974),
    ("正比例零点在临界线上", "超过 1/3", "改进为", 1974),
    ("德利涅", "韦伊猜想", "证明", 1974),
    ("有限域曲线上的黎曼猜想", "韦伊猜想", "推广为", 1974),
    ("奥德利兹科", "零点间距与随机矩阵", "计算", 1987),
    ("对关联猜想", "零点间距与随机矩阵", "被检验", 1987),
    ("康雷", "超过 2/5", "证明", 1989),
    ("超过 1/3", "超过 2/5", "改进为", 1989),
    ("孔涅", "迹公式进路", "提出", 1999),
    ("零点间距与随机矩阵", "迹公式进路", "启发", 1999),
    ("希尔伯特第八问题", "千禧年大奖难题", "再次入选", 2000),
    ("罗杰斯与陶哲轩", "德布鲁因–纽曼常数", "证明 Λ≥0", 2018),
    ("Polymath15 合作", "德布鲁因–纽曼常数", "Λ≤0.22", 2019),
    ("普拉特等四人", "超过 5/12", "证明", 2020),
    ("超过 2/5", "超过 5/12", "改进为", 2020),
    ("普拉特与特鲁吉安", "验证到高度 3·10¹²", "严格计算", 2021),
    ("计算机算零点", "验证到高度 3·10¹²", "延续", 2021),
    ("古思与梅纳德", "零点密度新界", "证明", 2024),
    ("零点密度估计", "零点密度新界", "首次改进", 2024),
    ("Claude 研究版", "超过 2/3 且为单零点", "证明", 2026),
    ("阿尔珀格", "超过 2/3 且为单零点", "与弗曼核验", 2026),
    ("拉姆祖里", "超过 2/3 且为单零点", "新证明", 2026),
    ("对关联猜想", "超过 2/3 且为单零点", "输入", 2026),
    ("超过 5/12", "超过 2/3 且为单零点", "改进为", 2026),
    ("阿尔珀格", "Lean 形式化证明", "发布", 2026),
    ("Lean 社区", "Lean 形式化证明", "检查编译与陈述", 2026),
    ("Lean 形式化证明", "千禧年大奖难题", "宣称解决", 2026),
]


def shot(sid, title, at, dur, narration, fit, highlight=None, beats=None):
    return {"id": sid, "title": title, "at": at, "dur": dur, "narration": narration,
            "fit": fit, "highlight": highlight if highlight is not None else fit, "beats": beats or []}


SHOTS = [
    shot("ch01", "素数有规律吗？", 1798, 13,
         "欧拉发现，所有素数的乘积与所有正整数的级数相等。高斯和勒让德数素数表，猜测 x 以内约有 x/ln x 个素数。",
         ["欧拉", "欧拉乘积公式", "高斯", "勒让德", "素数定理猜想"]),
    shot("ch02", "从级数到估计", 1850, 12,
         "狄利克雷把欧拉乘积推广为 L 函数，证明等差数列中有无穷多素数。切比雪夫把素数个数夹在两个常数倍之间。",
         ["狄利克雷", "狄利克雷 L 函数", "切比雪夫", "切比雪夫估计"],
         ["欧拉乘积公式", "狄利克雷", "狄利克雷 L 函数", "切比雪夫", "切比雪夫估计"]),
    shot("ch03", "1859：一篇八页的论文", 1859, 15,
         "黎曼把 ζ 函数延拓到复平面，写出用零点表示素数的显式公式，并写下：所有非平凡零点“很可能”都在实部为 1/2 的直线上。",
         ["黎曼", "ζ 函数的解析延拓", "素数的显式公式", "黎曼猜想", "切比雪夫估计"],
         ["黎曼", "ζ 函数的解析延拓", "素数的显式公式", "黎曼猜想"]),
    shot("ch04", "素数定理终于证明", 1905, 13,
         "1896 年，阿达马与德拉瓦莱普桑各自证明素数定理，关键是 Re(s)=1 上没有零点。冯·曼戈尔特严格证明了显式公式和零点计数公式。",
         ["冯·曼戈尔特", "零点计数公式", "阿达马", "德拉瓦莱普桑", "素数定理"],
         ["冯·曼戈尔特", "零点计数公式", "阿达马", "德拉瓦莱普桑", "素数定理", "素数的显式公式"]),
    shot("ch05", "第八问题与前 15 个零点", 1903, 12,
         "1900 年，希尔伯特把黎曼猜想列为二十世纪的第八个问题。三年后，格拉姆手算出前 15 个零点，全在临界线上。",
         ["希尔伯特", "希尔伯特第八问题", "格拉姆", "前 15 个零点"],
         ["希尔伯特", "希尔伯特第八问题", "黎曼猜想", "格拉姆", "前 15 个零点"]),
    shot("ch06", "剑桥的两个人", 1914, 13,
         "哈代证明临界线上有无穷多个零点。李特尔伍德证明 π(x)-li(x) 会无穷多次变号：数值规律再多，也代替不了证明。",
         ["哈代", "李特尔伍德", "临界线上无穷多零点", "π(x)-li(x) 变号"]),
    shot("ch07", "遗稿里的计算", 1932, 12,
         "西格尔整理黎曼的手稿，发现一套高效计算零点的公式。原来黎曼那句“很可能”的背后有亲手的计算。",
         ["西格尔", "黎曼–西格尔公式"],
         ["黎曼", "西格尔", "黎曼–西格尔公式"]),
    shot("ch08", "零点占多少？", 1942, 13,
         "英厄姆限制了偏离临界线的零点数量。塞尔伯格证明临界线上的零点占全部零点的一个正比例，比例问题由此开始。",
         ["英厄姆", "零点密度估计", "塞尔伯格", "正比例零点在临界线上"],
         ["英厄姆", "零点密度估计", "塞尔伯格", "正比例零点在临界线上", "临界线上无穷多零点"]),
    shot("ch09", "另一个世界已经证明", 1974, 14,
         "在有限域上，黎曼猜想有自己的版本。韦伊 1948 年证明了曲线的情形，德利涅 1974 年推广到一般代数簇。",
         ["韦伊", "有限域曲线上的黎曼猜想"],
         ["韦伊", "有限域曲线上的黎曼猜想", "德利涅", "韦伊猜想"],
         beats=[{"atSec": 6, "camera": {"fitIds": ["德利涅", "韦伊猜想"]}}]),
    shot("ch10", "机器开始数零点", 1953, 12,
         "图灵设计了检验零点的方法，并用曼彻斯特 Mark 1 计算机检查零点。计算从此成为研究的一部分。",
         ["图灵", "计算机算零点", "黎曼–西格尔公式"]),
    shot("ch11", "一次茶歇", 1987, 15,
         "蒙哥马利研究零点间距。戴森在茶歇时认出，那正是随机矩阵本征值的规律。奥德利兹科在第 10 的 20 次方个零点附近验证了这一点。",
         ["蒙哥马利", "戴森", "对关联猜想", "奥德利兹科", "零点间距与随机矩阵"]),
    shot("ch12", "比例接力", 2020, 14,
         "莱文森证明超过 1/3 的零点在临界线上，康雷推进到 2/5。2020 年，普拉特等四人把记录提高到约 41.7%。",
         ["莱文森", "超过 1/3"],
         ["莱文森", "超过 1/3", "康雷", "超过 2/5", "普拉特等四人", "超过 5/12"],
         beats=[{"atSec": 4.5, "camera": {"fitIds": ["康雷", "超过 2/5"]}},
                {"atSec": 9, "camera": {"fitIds": ["普拉特等四人", "超过 5/12"]}}]),
    shot("ch13", "百万美元与一个宣称", 2018, 14,
         "孔涅尝试用非交换几何寻找“零点的算子”。2000 年它成为千禧年大奖难题。2018 年阿蒂亚宣布证明，未被接受。",
         ["孔涅", "迹公式进路", "千禧年大奖难题", "阿蒂亚的宣称"]),
    shot("ch14", "逼近边界", 2024, 15,
         "罗杰斯与陶哲轩证明 Λ≥0：黎曼猜想若成立，便是“刚好成立”。普拉特与特鲁吉安严格验证了前 12 万亿个零点。古思与梅纳德改进了英厄姆八十多年未变的界。",
         ["罗杰斯与陶哲轩", "Polymath15 合作", "德布鲁因–纽曼常数"],
         ["罗杰斯与陶哲轩", "Polymath15 合作", "德布鲁因–纽曼常数", "普拉特与特鲁吉安", "验证到高度 3·10¹²", "古思与梅纳德", "零点密度新界"],
         beats=[{"atSec": 5.5, "camera": {"fitIds": ["普拉特与特鲁吉安", "验证到高度 3·10¹²"]}},
                {"atSec": 10, "camera": {"fitIds": ["古思与梅纳德", "零点密度新界"]}}]),
    shot("ch15", "2026 年 8 月：越过三分之二", 2026, 15,
         "Claude 研究版证明：超过 67.25% 的零点是单零点且在临界线上，阿尔珀格与弗曼核验。拉姆祖里随后给出更短的新证明。",
         ["Claude 研究版", "阿尔珀格", "拉姆祖里", "超过 2/3 且为单零点"],
         ["Claude 研究版", "阿尔珀格", "拉姆祖里", "超过 2/3 且为单零点", "超过 5/12"]),
    shot("ch16", "2026 年 11 月：机器检查的证明", 2026, 17,
         "阿尔珀格发布约 1700 万行的 Lean 证明库。Lean 社区声明：陈述正是黎曼猜想，代码可编译并通过内核检查。证明中的数学思想仍待人们读懂和审阅。",
         ["阿尔珀格", "超过 2/3 且为单零点"], ["阿尔珀格"],
         beats=[
             {"atSec": 1.2, "reveal": {"nodeIds": ["Lean 形式化证明", "Lean 社区"]}},
             {"atSec": 2.4, "camera": {"fitIds": ["阿尔珀格", "Lean 社区", "Lean 形式化证明"]},
              "highlight": {"nodeIds": ["阿尔珀格", "Lean 社区", "Lean 形式化证明"]}},
         ]),
    shot("ch17", "167 年", 2026, 14,
         "从黎曼的一句“很可能”，到机器检查的证明。这条线索穿过了数论、计算、物理与形式化数学。",
         ["黎曼", "黎曼猜想", "ζ 函数的解析延拓"],
         ["黎曼", "黎曼猜想", "ζ 函数的解析延拓"],
         beats=[
             {"atSec": 2, "camera": {"fitIds": ["希尔伯特第八问题", "希尔伯特", "格拉姆", "前 15 个零点"]}, "highlight": {"nodeIds": ["希尔伯特第八问题", "希尔伯特", "格拉姆", "前 15 个零点"]}},
             {"atSec": 4, "camera": {"fitIds": ["塞尔伯格", "正比例零点在临界线上", "英厄姆"]}, "highlight": {"nodeIds": ["塞尔伯格", "正比例零点在临界线上", "英厄姆"]}},
             {"atSec": 6, "camera": {"fitIds": ["蒙哥马利", "对关联猜想", "莱文森", "超过 1/3"]}, "highlight": {"nodeIds": ["蒙哥马利", "对关联猜想", "莱文森", "超过 1/3"]}},
             {"atSec": 8, "camera": {"fitIds": ["千禧年大奖难题", "孔涅", "迹公式进路"]}, "highlight": {"nodeIds": ["千禧年大奖难题", "孔涅", "迹公式进路"]}},
             {"atSec": 10, "camera": {"fitIds": ["Lean 形式化证明", "Lean 社区", "阿尔珀格", "超过 2/3 且为单零点"]}, "highlight": {"nodeIds": ["Lean 形式化证明", "Lean 社区", "阿尔珀格", "超过 2/3 且为单零点"]}},
         ]),
]


# The two 2026 milestones are months apart; the November one is held back by a reveal beat.
DATES = {
    "Lean 形式化证明": 2026, "Lean 社区": 2026,
}

# Layout. On a timeline the time coordinate is derived from the dates (about 18 world units
# per year here); only the lane coordinate is ours. Label-holding boxes keep their size on
# screen, so nodes of nearly the same year are packed side by side by the width of their words.
ROW_YEARS = 3.4
CHAR = 27              # world width of one CJK character at the film's usual zoom
GAP = 40               # free space between neighbours in one row
SPINE_X = -330         # the open problem and its milestones: a column of their own at the left
SPINE = {"黎曼猜想", "希尔伯特第八问题", "千禧年大奖难题"}
BASE_X = {"人物": 0, "研究团队": 0, "理论与成果": 420, "数值验证": 760, "问题与事件": 760}
PADDING = {"人物": 52, "研究团队": 52, "理论与成果": 40, "数值验证": 40, "问题与事件": 110}


def ems(text):
    total = 0.0
    for ch in text:
        if ord(ch) >= 0x2E80:
            total += 1
        elif ch == " ":
            total += 0.3
        elif ch.isupper() or ch.isdigit():
            total += 0.64
        else:
            total += 0.54
    return total


def width(node):
    return ems(node["id"]) * CHAR + PADDING[node["kind"]]


def assign_lanes(nodes, edges):
    """Greedy packing, earliest first: each node goes as close as it can to its own column
    and to the nodes it is related to, without overlapping a node of the same row."""
    neighbours = {n["id"]: set() for n in nodes}
    for e in edges:
        neighbours[e["source"]].add(e["target"])
        neighbours[e["target"]].add(e["source"])
    placed = {}  # id -> (x, half width, year)
    for n in nodes:
        if n["id"] in SPINE:
            placed[n["id"]] = (SPINE_X, width(n) / 2, n["visibleFrom"])
    floor = SPINE_X + max(w for (_, w, _) in placed.values()) + GAP
    for n in sorted(nodes, key=lambda n: n["visibleFrom"]):
        if n["id"] in SPINE:
            continue
        year, half = n["visibleFrom"], width(n) / 2
        near = [placed[m][0] for m in neighbours[n["id"]] if m in placed and m not in SPINE]
        pref = BASE_X[n["kind"]]
        if near:
            pref = 0.5 * pref + 0.5 * sum(near) / len(near)
        row = [(x, w) for (x, w, y) in placed.values() if abs(y - year) < ROW_YEARS]
        candidates = {pref} | {x + w + GAP + half for (x, w) in row} | {x - w - GAP - half for (x, w) in row}
        ok = [c for c in candidates
              if c - half >= floor and all(abs(c - x) >= w + half + GAP - 1e-6 for (x, w) in row)]
        x = min(ok, key=lambda c: abs(c - pref))
        placed[n["id"]] = (x, half, year)
    for n in nodes:
        n["position"] = {"y": round(placed[n["id"]][0])}


def build():
    nodes = []
    for pid, born, died, first in PEOPLE:
        n = {"id": pid, "kind": "人物", "visibleFrom": first}
        if born is not None:
            n["summary"] = f"{born}–{died}" if died else f"{born} 年生"
        nodes.append(n)
    for tid, year, summary in TEAMS:
        n = {"id": tid, "kind": "研究团队", "visibleFrom": year}
        if summary:
            n["summary"] = summary
        nodes.append(n)
    for rid, kind, year, summary, evidence in RESULTS:
        nodes.append({"id": rid, "kind": kind, "visibleFrom": year, "summary": summary, "evidence": evidence})

    for n in nodes:
        n["visibleFrom"] = DATES.get(n["id"], n["visibleFrom"])
    ids = {n["id"] for n in nodes}
    edges = []
    for i, (s, t, label, year) in enumerate(EDGES):
        assert s in ids and t in ids, (s, t)
        when = max(year, DATES.get(s, year), DATES.get(t, year))
        edges.append({"id": f"e{i + 1:02d}", "source": s, "target": t, "label": label, "visibleFrom": when})
    assign_lanes(nodes, edges)

    presentation = []
    for sh in SHOTS:
        for x in sh["fit"] + sh["highlight"]:
            assert x in ids, x
        out = {"id": sh["id"], "title": sh["title"], "narration": sh["narration"],
               "durationSec": sh["dur"], "domainAt": sh["at"], "transitionMs": 900,
               "camera": {"fitIds": sh["fit"]}, "highlight": {"nodeIds": sh["highlight"]}}
        if sh["beats"]:
            out["beats"] = sh["beats"]
        presentation.append(out)

    graph = {
        "format": "relgraph.graph/1",
        "diagram": "timeline",
        "meta": {
            "title": "黎曼猜想：从欧拉乘积到机器检查的证明",
            "description": "1737–2026 年，围绕 ζ 函数零点的人物、成果、数值验证与最新进展。",
            "sourceNote": "原始论文见各节点 evidence；2026 年进展据 arXiv:2609.02882 与 Lean FRO / Mathlib Initiative 2026-11-21 联合声明。数学界对 2026 年 11 月形式化证明的人工审阅仍在进行。",
        },
        "directed": True,
        "timeline": {"unit": "年"},
        "kinds": {"nodes": KINDS},
        "nodes": nodes,
        "edges": edges,
        "presentation": presentation,
    }
    project = {"format": "relgraph.studio/1", "config": {"view": {"timeAxis": "vertical"}}, "source": graph}
    (HERE / "riemann-hypothesis.graph.json").write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n")
    (HERE / "riemann-hypothesis.studio.json").write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n")
    print(len(nodes), "nodes", len(edges), "edges", len(presentation), "shots",
          sum(s["dur"] for s in SHOTS), "seconds")


if __name__ == "__main__":
    build()
