"""細胞と組織の模式図（content/diagrams/*.svg）を描く。解剖学総論の講義の内容をもとに、このアプリで描いたもの。
文字は入れない（平面図を作るとき text は除かれ、名前はアプリがラベルで付ける）。ラベルの点は content/organs.json の tissues に書く。
使い方: python3 scripts/diagrams/tissues.py（すべて描き直す）。cell.svg は手で描いたもの（ここでは描かない）
"""
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "content" / "diagrams"

# 色
CELL = "#f2a7bd"
CELL_LINE = "#8a3a5a"
NUC = "#5a3a8c"
CT = "#f8dde2"
CT_LINE = "#d79aa6"
BM = "#7a2a3a"
FRAME = "#9a8f80"
PANEL = "#fdf9f3"


def svg(w, h, comment, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f"  <!-- {comment}。このアプリで描いた模式図（scripts/diagrams/tissues.py）。文字は入れない -->\n"
            f'  <rect width="{w}" height="{h}" fill="#ffffff"/>\n' + "\n".join(body) + "\n</svg>\n")


def panel(x, y, w, h, fill=PANEL):
    return f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{fill}" stroke="{FRAME}" stroke-width="3"/>'


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def ellipse(cx, cy, rx, ry, fill, stroke=None, sw=2, rot=0):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    t = f' transform="rotate({f(rot)} {f(cx)} {f(cy)})"' if rot else ""
    return f'  <ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}" fill="{fill}"{s}{t}/>'


def poly(points, fill, stroke=None, sw=2):
    s = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ""
    return f'  <polygon points="{" ".join(f"{f(x)},{f(y)}" for x, y in points)}" fill="{fill}"{s}/>'


def path(d, fill="none", stroke=None, sw=2, extra=""):
    s = f' stroke="{stroke}" stroke-width="{f(sw)}" stroke-linecap="round" stroke-linejoin="round"' if stroke else ""
    return f'  <path d="{d}" fill="{fill}"{s}{extra}/>'


def rect(x, y, w, h, fill, stroke=None, sw=2, rx=0):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return f'  <rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}" rx="{f(rx)}" fill="{fill}"{s}/>'


def wavy(x0, y0, x1, amp, waves, phase=0.0):
    """x0→x1 の横の波線（y0 のまわり）"""
    n = 40
    pts = []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        y = y0 + amp * math.sin(2 * math.pi * waves * t + phase)
        pts.append(f"{f(x)} {f(y)}")
    return "M" + " L".join(pts)


def connective_band(x, y, w, h, rng):
    """上皮の下の結合組織（薄い桃色と線維）"""
    out = [rect(x, y, w, h, CT)]
    for k in range(3):
        out.append(path(wavy(x + 8, y + h * (0.3 + 0.25 * k), x + w - 8, 3, 2 + k * 0.5, rng.random() * 6), stroke=CT_LINE, sw=2))
    return out


# ---------------------------------------------------------------- 上皮の種類
def epithelium():
    rng = random.Random(4)
    W, H = 900, 560
    body = []
    pw, ph = 280, 250
    xs = [15, 310, 605]
    ys = [20, 290]
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            body.append(panel(x, y, pw, ph))
    def base(x, y):
        bm = y + ph - 70
        body.extend(connective_band(x + 3, bm, pw - 6, 67 - 3, rng))
        return bm

    def bm_line(x, bm):
        body.append(path(f"M{x + 3} {bm} L{x + pw - 3} {bm}", stroke=BM, sw=4))

    # 1 単層扁平上皮
    x, y = xs[0], ys[0]
    bm = base(x, y)
    cw = 54
    for k in range(5):
        cx = x + 6 + k * cw
        body.append(path(f"M{cx} {bm} L{cx} {bm - 9} L{cx + cw / 2 - 18} {bm - 9} Q{cx + cw / 2} {bm - 24} {cx + cw / 2 + 18} {bm - 9} L{cx + cw} {bm - 9} L{cx + cw} {bm} Z", fill=CELL, stroke=CELL_LINE, sw=2))
        body.append(ellipse(cx + cw / 2, bm - 10, 13, 6, NUC))
    bm_line(x, bm)
    # 2 単層立方上皮
    x, y = xs[1], ys[0]
    bm = base(x, y)
    cw = 45
    for k in range(6):
        cx = x + 5 + k * cw
        body.append(rect(cx, bm - 45, cw, 45, CELL, CELL_LINE, 2))
        body.append(ellipse(cx + cw / 2, bm - 22, 10, 10, NUC))
    bm_line(x, bm)
    # 3 単層円柱上皮（上に微絨毛）
    x, y = xs[2], ys[0]
    bm = base(x, y)
    cw = 34
    for k in range(8):
        cx = x + 4 + k * cw
        body.append(rect(cx, bm - 110, cw, 110, CELL, CELL_LINE, 2))
        body.append(ellipse(cx + cw / 2, bm - 34, 8, 15, NUC))
        for m in range(5):
            mx = cx + 5 + m * 6
            body.append(path(f"M{mx} {bm - 110} L{mx} {bm - 117}", stroke=CELL_LINE, sw=2))
    bm_line(x, bm)
    # 4 重層扁平上皮
    x, y = xs[0], ys[1]
    bm = base(x, y)
    # 基底の立方の細胞
    for k in range(10):
        cx = x + 5 + k * 27
        body.append(rect(cx, bm - 26, 27, 26, CELL, CELL_LINE, 2))
        body.append(ellipse(cx + 13.5, bm - 13, 6.5, 6.5, NUC))
    # 中の多角形の細胞
    for row in range(2):
        yy = bm - 26 - (row + 1) * 26
        off = 0 if row == 0 else 17
        for k in range(-1, 8):
            cx = x + 5 + off + k * 34
            if cx < x + 5 or cx + 34 > x + pw - 5:
                continue
            body.append(rect(cx, yy, 34, 26, "#f4b6c8", CELL_LINE, 2))
            body.append(ellipse(cx + 17, yy + 13, 7, 6, NUC))
    # 上の平たい細胞
    for row in range(3):
        yy = bm - 78 - (row + 1) * 12
        off = (row % 2) * 30
        for k in range(-1, 6):
            cx = x + 5 + off + k * 60
            x0, x1 = max(cx, x + 5), min(cx + 60, x + pw - 5)
            if x1 - x0 < 12:
                continue
            body.append(rect(x0, yy, x1 - x0, 12, "#f7c8d6", CELL_LINE, 2))
            if x1 - x0 > 40:
                body.append(ellipse((x0 + x1) / 2, yy + 6, 11, 3.5, NUC))
    bm_line(x, bm)
    # 5 多列線毛上皮（すべての細胞が基底膜に着く。核の高さがそろわない。杯細胞と線毛）
    x, y = xs[1], ys[1]
    bm = base(x, y)
    top = bm - 120
    tall = []
    k = 0
    cx = x + 6
    while cx + 34 <= x + pw - 4:
        tall.append(cx)
        cx += 34
    for idx, cx in enumerate(tall):
        goblet = idx == 4
        pts = [(cx, top), (cx + 34, top), (cx + 34, bm - 50), (cx + 24, bm), (cx + 10, bm), (cx, bm - 50)]
        body.append(poly(pts, "#f2a7bd", CELL_LINE, 2))
        if goblet:
            body.append(path(f"M{cx + 4} {top + 2} L{cx + 30} {top + 2} C{cx + 36} {top + 40} {cx + 26} {top + 60} {cx + 20} {top + 66} L{cx + 14} {top + 66} C{cx + 8} {top + 60} {cx - 2} {top + 40} {cx + 4} {top + 2} Z", fill="#dbe7f4", stroke="#6a86a8", sw=2))
            body.append(ellipse(cx + 17, bm - 22, 6, 9, NUC))
        else:
            ny = [bm - 62, bm - 78, bm - 56, bm - 84, 0, bm - 66, bm - 74][idx % 7]
            body.append(ellipse(cx + 17, ny, 7, 12, NUC))
            for m in range(7):
                mx = cx + 3 + m * 4.6
                body.append(path(f"M{f(mx)} {top} Q{f(mx + 2)} {top - 9} {f(mx + 1)} {top - 17}", stroke="#6a3a5a", sw=1.6))
    # 背の低い基底細胞（間のすき間に）
    for cx in tall[1:]:
        body.append(poly([(cx - 10, bm), (cx + 10, bm), (cx, bm - 40)], "#e793ad", CELL_LINE, 2))
        body.append(ellipse(cx, bm - 13, 5, 7, NUC))
    bm_line(x, bm)
    # 6 移行上皮（上に大きな被蓋細胞）
    x, y = xs[2], ys[1]
    bm = base(x, y)
    for k in range(10):
        cx = x + 5 + k * 27
        body.append(rect(cx, bm - 24, 27, 24, CELL, CELL_LINE, 2))
        body.append(ellipse(cx + 13.5, bm - 12, 6, 6, NUC))
    for row in range(2):
        yy = bm - 24 - (row + 1) * 30
        off = 0 if row == 0 else 16
        for k in range(-1, 9):
            cx = x + 5 + off + k * 33
            if cx < x + 5 or cx + 33 > x + pw - 5:
                continue
            body.append(rect(cx, yy, 33, 30, "#f4b6c8", CELL_LINE, 2, rx=8))
            body.append(ellipse(cx + 16.5, yy + 15, 7, 7, NUC))
    # 被蓋細胞（ドーム）
    yy = bm - 84
    for k in range(4):
        cx = x + 8 + k * 66
        body.append(path(f"M{cx} {yy} L{cx} {yy - 18} Q{cx + 33} {yy - 52} {cx + 66} {yy - 18} L{cx + 66} {yy} Z", fill="#f7c8d6", stroke=CELL_LINE, sw=2))
        body.append(ellipse(cx + 22, yy - 18, 7, 7, NUC))
        body.append(ellipse(cx + 44, yy - 18, 7, 7, NUC))
    bm_line(x, bm)
    return svg(W, H, "上皮の種類の模式図。上の段 左から単層扁平上皮・単層立方上皮・単層円柱上皮、下の段 左から重層扁平上皮・多列線毛上皮（杯細胞を1つ）・移行上皮。濃い線が基底膜、その下の薄い桃色が結合組織", body)


# ---------------------------------------------------------------- 4つの組織
def tissue_types():
    rng = random.Random(7)
    W, H = 900, 640
    body = [panel(15, 15, 425, 295), panel(460, 15, 425, 295), panel(15, 330, 425, 295), panel(460, 330, 425, 295)]
    # 上皮組織: 円柱の細胞の列
    bm = 230
    body.append(rect(18, bm, 419, 77, CT))
    body.append(path(wavy(26, bm + 30, 430, 3, 3), stroke=CT_LINE, sw=2))
    body.append(path(wavy(26, bm + 55, 430, 3, 2.5, 1), stroke=CT_LINE, sw=2))
    for k in range(10):
        cx = 22 + k * 41.4
        body.append(rect(cx, 110, 41.4, 120, CELL, CELL_LINE, 2))
        body.append(ellipse(cx + 20.7, 190, 10, 15, NUC))
    body.append(path(f"M18 {bm} L437 {bm}", stroke=BM, sw=4))
    # 結合組織: 膠原線維と細胞がまばら
    for k in range(6):
        y0 = 50 + k * 44
        body.append(path(wavy(472, y0, 872, 10, 1.5 + rng.random(), rng.random() * 6), stroke="#e58a9a", sw=9))
    for k in range(5):
        y0 = 60 + k * 50
        body.append(path(wavy(472, y0 + 18, 872, 6, 2.5, rng.random() * 6), stroke="#3a2a4a", sw=2))
    for cx, cy, rot in [(540, 90, 15), (700, 140, -20), (610, 230, 10), (800, 250, 30), (780, 70, -5)]:
        body.append(ellipse(cx, cy, 30, 8, "#c98ab8", "#7a3a6a", 2, rot))
        body.append(ellipse(cx, cy, 12, 4, NUC, None, 0, rot))
    # 筋組織: 横紋のある長い筋線維
    for k in range(4):
        y0 = 365 + k * 62
        body.append(rect(25, y0, 405, 50, "#e07a6a", "#8a2a20", 2, rx=24))
        for sx in range(40, 420, 9):
            body.append(path(f"M{sx} {y0 + 3} L{sx} {y0 + 47}", stroke="#b0483a", sw=3))
        for nx in [90, 220, 340]:
            body.append(ellipse(nx + k * 12, y0 + 7, 16, 4, NUC))
    # 神経組織: 神経細胞と小さい神経膠細胞
    body.append(path("M600 470 C640 430 700 430 730 470 C770 470 820 470 872 474", stroke="#c9a030", sw=7))
    for d in ["M600 470 C570 440 540 420 500 404", "M600 470 C560 470 530 480 486 470", "M610 480 C590 520 560 550 520 580", "M640 440 C630 400 640 380 620 350", "M660 450 C690 410 710 390 740 370", "M520 404 C510 380 500 370 486 360", "M560 545 C540 560 520 600 524 612"]:
        body.append(path(d, stroke="#c9a030", sw=6))
    body.append(path("M600 470 C590 430 630 410 660 430 C690 450 690 500 650 510 C610 520 600 500 600 470 Z", fill="#f2cf6a", stroke="#a07a16", sw=3))
    body.append(ellipse(645, 470, 16, 16, NUC))
    for cx, cy in [(760, 540), (820, 400), (540, 620 - 40), (700, 590), (500, 520)]:
        body.append(ellipse(cx, cy, 11, 9, "#9ac6a4", "#3f7a4f", 2))
        for a in range(5):
            ang = a * 72 + 20
            body.append(path(f"M{cx} {cy} L{f(cx + 22 * math.cos(math.radians(ang)))} {f(cy + 22 * math.sin(math.radians(ang)))}", stroke="#3f7a4f", sw=2))
    return svg(W, H, "人体の4つの組織の模式図。左上 上皮組織（細胞が隙間なく並び基底膜にのる）、右上 結合組織（線維と細胞がまばら）、左下 筋組織（横紋のある筋線維）、右下 神経組織（神経細胞と小さな神経膠細胞）", body)


# ---------------------------------------------------------------- 結合組織と血液
def connective_tissue():
    rng = random.Random(11)
    W, H = 900, 640
    body = [panel(15, 15, 530, 610, "#fbeef0"), panel(565, 15, 320, 190, "#eef4f8"), panel(565, 225, 320, 190, "#f6efdf"), panel(565, 435, 320, 190, "#fff3e6")]
    # 疎性結合組織
    for k, (y0, amp, wv) in enumerate([(70, 14, 1.2), (150, 10, 1.6), (300, 12, 1.1), (420, 16, 1.4), (560, 10, 1.8)]):
        d = wavy(30, y0, 530, amp, wv, rng.random() * 6)
        body.append(path(d, stroke="#e07a8e", sw=14))
        body.append(path(d, stroke="#f4b3c0", sw=5))
    for k in range(6):
        y0 = 100 + k * 85
        body.append(path(wavy(30, y0, 530, 18, 2.2, rng.random() * 6), stroke="#2f2340", sw=2.5))
    # 線維芽細胞（紡錘形）
    for cx, cy, rot in [(120, 210, 12), (360, 110, -18), (250, 470, 8), (440, 360, 25)]:
        body.append(path(f"M{cx - 52} {cy} Q{cx} {cy - 16} {cx + 52} {cy} Q{cx} {cy + 16} {cx - 52} {cy} Z", fill="#c98ab8", stroke="#7a3a6a", sw=2, extra=f' transform="rotate({rot} {cx} {cy})"'))
        body.append(ellipse(cx, cy, 16, 5.5, NUC, None, 0, rot))
    # 脂肪細胞（大きな脂肪滴、核は端に押しやられる）
    for cx, cy, r in [(130, 380, 46), (215, 330, 40), (205, 415, 38), (115, 470, 36)]:
        body.append(f'  <circle cx="{cx}" cy="{cy}" r="{r}" fill="#fdf0c4" stroke="#c9a030" stroke-width="3"/>')
    body.append(path("M100 342 Q112 336 124 337", stroke=NUC, sw=6))
    # マクロファージ
    body.append(path("M380 230 C400 205 440 210 452 232 C468 258 450 290 420 290 C396 292 372 270 380 230 Z", fill="#b9a0d8", stroke="#5b3f8c", sw=2))
    body.append(path("M402 246 C412 236 430 240 432 256 C434 268 420 272 414 262 C408 270 396 262 402 246 Z", fill=NUC))
    # 肥満細胞（顆粒）
    body.append(ellipse(330, 560, 34, 24, "#d8c2e6", "#6a3a8c", 2))
    for k in range(26):
        a = rng.random() * 2 * math.pi
        rr = math.sqrt(rng.random())
        body.append(f'  <circle cx="{f(330 + 28 * rr * math.cos(a))}" cy="{f(560 + 19 * rr * math.sin(a))}" r="3" fill="#4a1a6a"/>')
    # 毛細血管と赤血球
    body.append(path("M470 470 C480 520 500 560 520 610", stroke="#c0392b", sw=26))
    body.append(path("M470 470 C480 520 500 560 520 610", stroke="#f6c9c2", sw=18))
    for t in [0.15, 0.45, 0.75]:
        x = 470 + 50 * t
        y = 470 + 140 * t
        body.append(ellipse(x + 2, y, 8, 5, "#d6453a", None, 0, 70))
    # 軟骨組織（基質の中の小腔に軟骨細胞。同じ細胞から分かれた2〜4個の群）
    for gx, gy in [(615, 70), (715, 100), (820, 62), (640, 160), (770, 160), (850, 140)]:
        for dx, dy in [(-15, 0), (15, 2)] if (gx + gy) % 3 else [(-15, -9), (15, -9), (0, 14)]:
            body.append(ellipse(gx + dx, gy + dy, 15, 12, "#ffffff", "#7a9ab0", 2))
            body.append(ellipse(gx + dx, gy + dy, 11, 8.5, "#8aa6c8"))
            body.append(ellipse(gx + dx, gy + dy, 4.5, 4.5, NUC))
    # 骨組織（骨単位: 中心管のまわりに層板と骨細胞）
    cx, cy = 725, 320
    for r in [78, 64, 50, 36, 22]:
        body.append(f'  <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#c4a46a" stroke-width="3"/>')
    body.append(f'  <circle cx="{cx}" cy="{cy}" r="12" fill="#f0c0b0" stroke="#a0522d" stroke-width="3"/>')
    for r in [29, 43, 57, 71]:
        for k in range(int(r / 6)):
            a = 2 * math.pi * k / int(r / 6) + r
            ox, oy = cx + r * math.cos(a), cy + r * math.sin(a)
            body.append(ellipse(ox, oy, 5, 2.6, "#5a3a20", None, 0, math.degrees(a) + 90))
            for s in (-1, 1):
                body.append(path(f"M{f(ox)} {f(oy)} L{f(ox + s * 6 * math.cos(a))} {f(oy + s * 6 * math.sin(a))}", stroke="#5a3a20", sw=1))
    for ox, oy in [(600, 250), (850, 390), (600, 395), (855, 250)]:
        body.append(ellipse(ox, oy, 5, 2.6, "#5a3a20"))
    # 血液（赤血球・白血球・血小板）
    for k in range(13):
        x = 590 + rng.random() * 270
        y = 458 + rng.random() * 145
        if 680 < x < 760 and 500 < y < 580:
            continue
        body.append(f'  <circle cx="{f(x)}" cy="{f(y)}" r="13" fill="#d6453a" stroke="#8a1a12" stroke-width="2"/>')
        body.append(f'  <circle cx="{f(x)}" cy="{f(y)}" r="5.5" fill="#ef8a80"/>')
    body.append('  <circle cx="720" cy="540" r="26" fill="#ece0f2" stroke="#6a3a8c" stroke-width="2"/>')
    body.append(path("M705 532 C712 520 724 530 720 540 C732 532 742 546 732 556 C724 562 716 552 720 546 C712 556 698 548 705 532 Z", fill="#6a3a9c"))
    for x, y in [(800, 470), (812, 478), (620, 600), (850, 590), (760, 455)]:
        body.append(ellipse(x, y, 4.5, 3, "#8a5ab0", None, 0, 30))
    return svg(W, H, "結合組織と血液の模式図。左 疎性結合組織（膠原線維・弾性線維・線維芽細胞・脂肪細胞・マクロファージ・肥満細胞・毛細血管）、右上 軟骨組織（小腔の軟骨細胞）、右中 骨組織（骨単位と骨細胞）、右下 血液（赤血球・白血球・血小板）", body)


# ---------------------------------------------------------------- 筋組織
def muscle_tissue():
    rng = random.Random(3)
    W, H = 900, 600
    body = [panel(15, 15, 800, 180), panel(15, 210, 800, 180), panel(15, 405, 800, 180)]
    # 骨格筋: 長い円柱の筋線維、横紋、多くの核が端に
    for k in range(3):
        y0 = 35 + k * 52
        body.append(rect(30, y0, 770, 42, "#e07a6a", "#8a2a20", 2, rx=20))
        for sx in range(44, 790, 8):
            body.append(path(f"M{sx} {y0 + 3} L{sx} {y0 + 39}", stroke="#b0483a", sw=3))
        for nx in range(70 + k * 30, 780, 130):
            body.append(ellipse(nx, y0 + 5, 16, 4.2, NUC))
    # 心筋: 枝分かれした細胞、横紋、中央に1つの核、介在板
    y0 = 228
    fibers = [
        "M30 240 L800 240 L800 280 L30 280 Z",
        "M30 300 L800 300 L800 340 L30 340 Z",
        "M30 350 L800 350 L800 372 L30 372 Z",
    ]
    for d in fibers:
        body.append(path(d, fill="#d9706a", stroke="#8a2a20", sw=2))
    # 枝（上下の線維をつなぐ）
    for bx in [160, 420, 660]:
        body.append(path(f"M{bx} 280 L{bx + 50} 300 L{bx + 90} 300 L{bx + 40} 280 Z", fill="#d9706a", stroke="#8a2a20", sw=2))
    for bx in [290, 560]:
        body.append(path(f"M{bx} 340 L{bx + 40} 350 L{bx + 80} 350 L{bx + 40} 340 Z", fill="#d9706a", stroke="#8a2a20", sw=2))
    for sx in range(38, 800, 8):
        for ya, yb in [(243, 277), (303, 337), (352, 370)]:
            body.append(path(f"M{sx} {ya} L{sx} {yb}", stroke="#ad4a40", sw=2.6))
    # 介在板（細胞の境の階段状の濃い線）
    for ix in [120, 300, 480, 700]:
        body.append(path(f"M{ix} 240 L{ix} 252 L{ix + 8} 252 L{ix + 8} 266 L{ix} 266 L{ix} 280", stroke="#2a1010", sw=4))
    for ix in [210, 400, 610]:
        body.append(path(f"M{ix} 300 L{ix} 312 L{ix + 8} 312 L{ix + 8} 326 L{ix} 326 L{ix} 340", stroke="#2a1010", sw=4))
    for ix in [140, 360, 680]:
        body.append(path(f"M{ix} 350 L{ix} 360 L{ix + 6} 360 L{ix + 6} 372", stroke="#2a1010", sw=4))
    for nx, ny in [(60, 260), (210, 260), (390, 260), (590, 260), (760, 260), (110, 320), (300, 320), (500, 320), (700, 320), (60, 361), (250, 361), (520, 361), (740, 361)]:
        body.append(ellipse(nx, ny, 11, 6, NUC))
    # 平滑筋: 紡錘形の細胞が重なり合う、核は中央に1つ、横紋なし（枠の中で切る）
    body.append('  <clipPath id="smooth"><rect x="30" y="418" width="770" height="160" rx="10"/></clipPath>')
    body.append('  <g clip-path="url(#smooth)">')
    for row in range(5):
        yy = 425 + row * 30
        off = (row % 2) * 70
        for k in range(-1, 6):
            cx = 30 + off + k * 150 + 75
            x0, x1 = cx - 85, cx + 85
            if x1 < 40 or x0 > 790:
                continue
            body.append(path(f"M{x0} {yy + 16} Q{cx} {yy - 4} {x1} {yy + 16} Q{cx} {yy + 36} {x0} {yy + 16} Z", fill="#e99a8a", stroke="#9a4a3a", sw=2))
            if 40 < cx < 790:
                body.append(ellipse(cx, yy + 16, 20, 4.5, NUC))
    body.append("  </g>")
    # 横紋筋のかっこ（骨格筋と心筋）
    body.append(path("M835 30 L860 30 L860 375 L835 375", stroke="#5a4a3a", sw=5))
    body.append(path("M860 202 L880 202", stroke="#5a4a3a", sw=5))
    return svg(W, H, "筋組織の模式図。上 骨格筋（長い筋線維・横紋・端に多くの核）、中 心筋（枝分かれ・横紋・中央に1つの核・介在板）、下 平滑筋（紡錘形・中央に1つの核・横紋なし）。右のかっこは横紋筋（骨格筋と心筋）", body)


# ---------------------------------------------------------------- 神経細胞
def neuron():
    W, H = 920, 460
    body = []
    Y = "#f2cf6a"
    YL = "#a07a16"
    # 樹状突起
    dendrites = ["M200 230 C170 190 150 160 110 140", "M110 140 C90 110 80 90 60 70", "M110 140 C80 140 60 150 34 146",
                 "M200 230 C150 230 110 240 70 236", "M70 236 C50 220 40 210 24 206", "M70 236 C50 250 40 262 28 280",
                 "M205 250 C180 300 150 330 120 370", "M120 370 C100 380 80 392 60 396", "M120 370 C120 400 116 420 108 440",
                 "M230 200 C230 160 250 120 240 80", "M240 80 C220 60 214 46 200 30", "M240 80 C260 60 270 46 290 34",
                 "M255 270 C270 320 280 350 300 400"]
    for d in dendrites:
        body.append(path(d, stroke=YL, sw=11))
    for d in dendrites:
        body.append(path(d, stroke=Y, sw=6))
    # 細胞体
    body.append(path("M200 230 C190 190 230 170 260 186 C292 200 300 250 280 270 C260 292 210 290 200 260 Z", fill=Y, stroke=YL, sw=4))
    body.append(ellipse(244, 232, 22, 22, "#e9e2f6", NUC, 3))
    body.append(ellipse(248, 236, 8, 8, NUC))
    # 軸索小丘と軸索
    body.append(path("M284 236 L300 230 L300 246 L284 252 Z", fill=Y, stroke=YL, sw=3))
    body.append(path("M300 238 L770 238", stroke=YL, sw=8))
    body.append(path("M300 238 L770 238", stroke=Y, sw=4))
    # 髄鞘（シュワン細胞が巻く）とランビエ絞輪
    for k, x0 in enumerate([318, 420, 522, 624]):
        body.append(rect(x0, 222, 92, 32, "#8fb6e8", "#2f5a9a", 3, rx=15))
        body.append(path(f"M{x0 + 10} 222 L{x0 + 10} 254 M{x0 + 82} 222 L{x0 + 82} 254", stroke="#5a86c0", sw=2))
        body.append(ellipse(x0 + 46, 226, 14, 5, "#2f4a8c"))
    # 終末の枝と終末ボタン
    for d in ["M770 238 C800 238 812 210 836 196", "M770 238 C800 238 820 240 846 236", "M770 238 C800 238 812 268 836 282"]:
        body.append(path(d, stroke=YL, sw=7))
        body.append(path(d, stroke=Y, sw=3))
    for cx, cy in [(840, 194), (850, 236), (840, 284)]:
        body.append(ellipse(cx, cy, 9, 9, Y, YL, 3))
    # 次の細胞（シナプスの相手）
    body.append(path("M866 150 C900 160 912 220 906 260 C900 310 880 330 866 330 C876 290 878 200 866 150 Z", fill="#c6d8a8", stroke="#5a7a3a", sw=3))
    body.append(path("M858 186 L862 202 M860 228 L864 244 M858 276 L862 292", stroke="#5a7a3a", sw=3))
    return svg(W, H, "神経細胞（ニューロン）の模式図。左から樹状突起・神経細胞体（核と核小体）・軸索小丘・軸索。軸索はシュワン細胞の髄鞘に巻かれ、髄鞘の切れ目がランビエ絞輪。右端で枝分かれした軸索終末（終末ボタン）が次の細胞とシナプスをつくる", body)


# ---------------------------------------------------------------- 神経膠細胞
def neuroglia():
    W, H = 920, 520
    body = [panel(15, 15, 600, 490), panel(635, 15, 270, 490, "#f6f3ea")]
    Y, YL = "#f2cf6a", "#a07a16"
    # 中枢: 神経細胞
    body.append(path("M300 250 C290 210 330 190 360 206 C392 220 398 270 378 290 C358 312 308 310 300 280 Z", fill=Y, stroke=YL, sw=4))
    body.append(ellipse(344, 252, 18, 18, "#e9e2f6", NUC, 3))
    for d in ["M300 250 C260 220 230 200 200 190", "M310 290 C290 330 270 360 250 390", "M340 206 C340 180 348 160 342 140"]:
        body.append(path(d, stroke=YL, sw=10))
        body.append(path(d, stroke=Y, sw=5))
    body.append(path("M390 262 L590 262", stroke=YL, sw=7))
    body.append(path("M390 262 L590 262", stroke=Y, sw=3))
    # 稀突起膠細胞（1つの細胞が何本もの軸索に髄鞘をつくる）
    body.append(ellipse(470, 195, 24, 20, "#c8b6e8", "#5b3f8c", 3))
    body.append(ellipse(470, 195, 9, 9, NUC))
    body.append(rect(420, 250, 70, 24, "#c8b6e8", "#5b3f8c", 3, rx=11))
    body.append(path("M462 213 C456 225 454 238 455 250", stroke="#5b3f8c", sw=4))
    body.append(path("M600 150 L400 150", stroke=YL, sw=6))
    body.append(path("M600 150 L400 150", stroke=Y, sw=2.5))
    body.append(rect(510, 138, 70, 24, "#c8b6e8", "#5b3f8c", 3, rx=11))
    body.append(path("M486 182 C500 175 510 168 518 162", stroke="#5b3f8c", sw=4))
    # 星状膠細胞（毛細血管に終足）
    body.append(path("M60 70 L60 470", stroke="#c0392b", sw=30))
    body.append(path("M60 70 L60 470", stroke="#f6c9c2", sw=20))
    cx, cy = 170, 300
    for ang, ln in [(200, 95), (170, 100), (230, 110), (300, 70), (20, 80), (60, 70), (110, 60), (340, 90)]:
        ex = cx + ln * math.cos(math.radians(ang))
        ey = cy + ln * math.sin(math.radians(ang))
        body.append(path(f"M{cx} {cy} Q{f((cx + ex) / 2 + 8)} {f((cy + ey) / 2 - 6)} {f(ex)} {f(ey)}", stroke="#3f7a4f", sw=6))
        if 140 < ang < 250:
            body.append(ellipse(ex, ey, 9, 6, "#7fbf8f", "#3f7a4f", 2))
    body.append(ellipse(cx, cy, 20, 18, "#7fbf8f", "#3f7a4f", 3))
    body.append(ellipse(cx, cy, 8, 7, NUC))
    # ミクログリア（小さく、とげのある突起）
    mx, my = 470, 400
    for ang in range(0, 360, 45):
        ex = mx + 34 * math.cos(math.radians(ang))
        ey = my + 34 * math.sin(math.radians(ang))
        body.append(path(f"M{mx} {my} L{f(ex)} {f(ey)} M{f(ex)} {f(ey)} L{f(ex + 8 * math.cos(math.radians(ang + 40)))} {f(ey + 8 * math.sin(math.radians(ang + 40)))}", stroke="#2f6a9a", sw=3))
    body.append(ellipse(mx, my, 14, 10, "#8fc0e0", "#2f6a9a", 2))
    body.append(ellipse(mx, my, 7, 4, NUC))
    # 上衣細胞（脳室の壁。線毛）
    body.append(rect(100, 30, 500, 34, "#dbe9f5"))
    for k in range(9):
        x0 = 112 + k * 52
        body.append(rect(x0, 64, 52, 46, "#b8d0ec", "#3a5a8c", 2))
        body.append(ellipse(x0 + 26, 90, 9, 9, NUC))
        for m in range(6):
            body.append(path(f"M{x0 + 6 + m * 8} 64 Q{x0 + 9 + m * 8} 54 {x0 + 7 + m * 8} 46", stroke="#3a5a8c", sw=1.6))
    # 末梢: 神経節の神経細胞と衛星細胞
    gx, gy = 770, 160
    body.append(ellipse(gx, gy, 52, 50, Y, YL, 4))
    body.append(ellipse(gx, gy, 16, 16, "#e9e2f6", NUC, 3))
    for k in range(9):
        a = 2 * math.pi * k / 9
        body.append(ellipse(gx + 62 * math.cos(a), gy + 60 * math.sin(a), 16, 9, "#a8d4c4", "#2f7a6a", 2, math.degrees(a) + 90))
        body.append(ellipse(gx + 62 * math.cos(a), gy + 60 * math.sin(a), 6, 3.5, NUC, None, 0, math.degrees(a) + 90))
    # 末梢: シュワン細胞が巻く軸索
    body.append(path("M650 400 L890 400", stroke=YL, sw=7))
    body.append(path("M650 400 L890 400", stroke=Y, sw=3))
    for x0 in [668, 772]:
        body.append(rect(x0, 384, 94, 32, "#8fb6e8", "#2f5a9a", 3, rx=15))
        body.append(ellipse(x0 + 47, 388, 14, 5, "#2f4a8c"))
    return svg(W, H, "神経膠細胞の模式図。左の枠は中枢神経系: 上に脳室の壁の上衣細胞（線毛）、左に毛細血管と終足をのばす星状膠細胞、中に神経細胞、右上に何本もの軸索に髄鞘をつくる稀突起膠細胞、下にミクログリア。右の枠は末梢神経系: 神経節の神経細胞を囲む衛星細胞と、軸索に髄鞘をつくるシュワン細胞", body)


# ---------------------------------------------------------------- 体表からの層と注射
def skin_block(body, X0, X1, epi, derm, sub, bottom, rng, fat=70):
    """表皮・真皮（乳頭）・皮下組織（脂肪）の層。X1 - X0 は 40 の倍数"""
    body.append(rect(X0, sub, X1 - X0, bottom - sub, "#f8e3a0", "#b89a40", 2))
    for k in range(fat):
        x = X0 + 12 + rng.random() * (X1 - X0 - 24)
        y = sub + 12 + rng.random() * (bottom - sub - 24)
        body.append(f'  <circle cx="{f(x)}" cy="{f(y)}" r="{f(9 + rng.random() * 9)}" fill="#fdf0c4" stroke="#d9b860" stroke-width="1.5"/>')
    n = (X1 - X0) // 40
    waves = " ".join(f"Q{X0 + 20 + 40 * k} {derm - 18} {X0 + 40 + 40 * k} {derm}" for k in range(n))
    back = " ".join(f"Q{X1 - 20 - 40 * k} {derm - 18} {X1 - 40 - 40 * k} {derm}" for k in range(n))
    body.append(path(f"M{X0} {derm} {waves} L{X1} {sub} L{X0} {sub} Z", fill="#f3c4b8", stroke="#b07060", sw=2))
    for k in range(5):
        body.append(path(wavy(X0 + 10, derm + 25 + k * 15, X1 - 10, 3, 4, k), stroke="#e0a090", sw=1.8))
    body.append(path(f"M{X0} {epi} L{X1} {epi} L{X1} {derm} {back} Z", fill="#e9b48c", stroke="#8a5a3a", sw=2))
    body.append(path(f"M{X0} {epi + 4} L{X1} {epi + 4}", stroke="#c98a5a", sw=4))


def body_layers():
    rng = random.Random(5)
    W, H = 1060, 640
    X0, X1 = 40, 1000
    epi, derm, sub, fas, mus = 150, 172, 270, 410, 422
    body = []
    # 骨
    body.append(rect(X0, mus + 128, X1 - X0, 610 - (mus + 128), "#eee0bf", "#8a7a50", 3))
    body.append(path(f"M{X0} {mus + 134} L{X1} {mus + 134}", stroke="#c9a96a", sw=4))
    for k in range(22):
        x = X0 + 20 + rng.random() * (X1 - X0 - 40)
        y = mus + 145 + rng.random() * 40
        body.append(ellipse(x, y, 10 + rng.random() * 8, 5 + rng.random() * 4, "#d9c79a"))
    # 骨格筋（筋束）と動脈
    body.append(rect(X0, mus, X1 - X0, 128, "#c9534a", "#7a2020", 3))
    for k in range(7):
        body.append(path(wavy(X0 + 4, mus + 10 + k * 17, X1 - 4, 1.5, 3, k), stroke="#a8403a", sw=2))
    body.append(ellipse(800, mus + 80, 17, 14, "#c0392b", "#6e1a12", 3))
    # 筋膜
    body.append(rect(X0, fas, X1 - X0, mus - fas, "#ece9e4", "#8a8a8a", 2))
    # 皮膚と皮下組織
    skin_block(body, X0, X1, epi, derm, sub, fas, rng, fat=90)
    # 皮静脈（皮下組織の浅い所）
    body.append(rect(650, 282, X1 - 650, 30, "#3f66b0", "#1f3a70", 3, rx=15))
    body.append(path(f"M662 291 L{X1 - 6} 291", stroke="#7a9ad8", sw=3))

    def syringe(tip, angle, right=False):
        """tip: 針先、angle: 皮膚の面からの角度（度）。針は左上（right なら右上）から入り、皮膚の外に 35 出たところから筒"""
        a = math.radians(angle)
        dx, dy = (math.cos(a) if right else -math.cos(a)), -math.sin(a)
        reach = (tip[1] - epi) / math.sin(a) + 35
        nx, ny = tip[0] + dx * reach, tip[1] + dy * reach
        out = [path(f"M{f(tip[0])} {f(tip[1])} L{f(nx)} {f(ny)}", stroke="#4a4a4a", sw=3.5)]
        bl, w = 100, 15
        bx, by = nx + dx * bl, ny + dy * bl
        px, py = -dy * w, dx * w
        out.append(poly([(nx + px, ny + py), (bx + px, by + py), (bx - px, by - py), (nx - px, ny - py)], "#dfe9f2", "#4a6a8a", 3))
        out.append(poly([(nx + px * 0.5, ny + py * 0.5), (nx + dx * 60 + px * 0.5, ny + dy * 60 + py * 0.5), (nx + dx * 60 - px * 0.5, ny + dy * 60 - py * 0.5), (nx - px * 0.5, ny - py * 0.5)], "#b8d4ec"))
        out.append(path(f"M{f(bx + px * 1.6)} {f(by + py * 1.6)} L{f(bx - px * 1.6)} {f(by - py * 1.6)}", stroke="#4a6a8a", sw=6))
        out.append(path(f"M{f(bx)} {f(by)} L{f(bx + dx * 34)} {f(by + dy * 34)}", stroke="#4a6a8a", sw=7))
        return out
    body.append(ellipse(300, 178, 26, 9, "#f6d0c4", "#c08070", 1.5))  # 皮内注射の膨疹
    body += syringe((300, 184), 15)   # 皮内（真皮の浅い所）
    body += syringe((470, 340), 45)   # 皮下
    body += syringe((600, 480), 90)   # 筋肉
    body += syringe((740, 297), 40, right=True)  # 静脈（皮静脈）
    return svg(W, H, "体表から深部への層と注射の深さの模式図。上から表皮・真皮・皮下組織（脂肪と浅い所の皮静脈）・筋膜・骨格筋（中に動脈）・骨。注射器は左から皮内注射（真皮へ浅く、膨疹ができる）・皮下注射（45度）・筋肉注射（90度）、右から静脈注射（皮静脈へ）", body)


# ---------------------------------------------------------------- 熱傷の深さ
def burn_depth():
    W, H = 820, 560
    X0, X1 = 40, 760
    epi, derm, mid, sub, bottom = 150, 172, 290, 400, 530
    body = []
    skin_block(body, X0, X1, epi, derm, sub, bottom, random.Random(9), fat=45)
    body.append(path(f"M{X0} {mid} L{X1} {mid}", stroke="#b07060", sw=2.5, extra=' stroke-dasharray="10 8"'))
    # 毛と汗腺（深さの目安）
    body.append(path("M680 60 L690 370", stroke="#3a2a20", sw=6))
    body.append(ellipse(690, 372, 14, 18, "#c08060", "#6a3a20", 2))
    body.append(path("M110 150 C112 220 106 300 116 380 C100 390 120 400 130 390 C140 400 150 380 130 372", stroke="#5a7aa8", sw=4))

    def arrow(x, y_end, color):
        return [path(f"M{x} 40 L{x} {y_end - 26}", stroke=color, sw=26), poly([(x - 30, y_end - 30), (x + 30, y_end - 30), (x, y_end)], color)]
    body += arrow(230, 166, "#f2c230")
    body += arrow(350, 282, "#f08a30")
    body += arrow(470, 392, "#d9402a")
    body += arrow(590, 500, "#8a1a1a")
    return svg(W, H, "熱傷の深さの模式図。上から表皮・真皮（点線より上が浅い所、下が深い所）・皮下組織。矢印は左から I度（表皮まで）・浅達性II度（真皮の浅い所まで）・深達性II度（真皮の深い所まで）・III度（皮下組織まで）。右に毛包、左に汗腺を深さの目安に描いた", body)


# ---------------------------------------------------------------- 人体の階層
def levels():
    W, H = 1100, 330
    body = []
    cy = 170
    xs = [80, 235, 390, 545, 705, 865, 1020]
    # 矢印
    for a, b in zip(xs, xs[1:]):
        body.append(path(f"M{a + 52} {cy} L{b - 56} {cy}", stroke="#9a8f80", sw=5))
        body.append(poly([(b - 58, cy - 10), (b - 58, cy + 10), (b - 44, cy)], "#9a8f80"))
    # 原子・分子
    x = xs[0]
    body.append(path(f"M{x - 20} {cy + 10} L{x + 4} {cy - 18} L{x + 26} {cy + 12}", stroke="#5a5a5a", sw=5))
    body.append(f'  <circle cx="{x - 20}" cy="{cy + 10}" r="17" fill="#f2f2f2" stroke="#6a6a6a" stroke-width="3"/>')
    body.append(f'  <circle cx="{x + 4}" cy="{cy - 18}" r="22" fill="#e0453a" stroke="#8a1a12" stroke-width="3"/>')
    body.append(f'  <circle cx="{x + 26}" cy="{cy + 12}" r="17" fill="#f2f2f2" stroke="#6a6a6a" stroke-width="3"/>')
    # 細胞小器官（ミトコンドリア）
    x = xs[1]
    body.append(ellipse(x, cy, 50, 26, "#f0a35a", "#8a4a10", 4, -15))
    body.append(path(f"M{x - 38} {cy + 8} L{x - 24} {cy - 12} L{x - 10} {cy + 14} L{x + 4} {cy - 12} L{x + 18} {cy + 14} L{x + 32} {cy - 10}", stroke="#8a4a10", sw=3, extra=f' transform="rotate(-15 {x} {cy})"'))
    # 細胞
    x = xs[2]
    body.append(ellipse(x, cy, 52, 44, "#fbe7d8", "#a0522d", 5))
    body.append(ellipse(x - 6, cy - 2, 18, 18, "#d9c6ee", "#5b3f8c", 3))
    body.append(ellipse(x + 26, cy + 14, 10, 5, "#f0a35a", "#8a4a10", 2, 20))
    body.append(ellipse(x + 22, cy - 22, 9, 5, "#f6d57a", "#a07a16", 2))
    # 組織（細胞が並んだ層）
    x = xs[3]
    for r in range(3):
        for c in range(4):
            cx = x - 48 + c * 30 + (r % 2) * 10
            yy = cy - 42 + r * 30
            body.append(rect(cx, yy, 28, 28, "#f2a7bd", "#8a3a5a", 2, rx=5))
            body.append(ellipse(cx + 14, yy + 14, 5.5, 5.5, NUC))
    # 器官（胃）
    x = xs[4]
    body.append(path(f"M{x - 10} {cy - 64} L{x + 8} {cy - 64} C{x + 10} {cy - 46} {x + 20} {cy - 40} {x + 34} {cy - 36} C{x + 60} {cy - 26} {x + 62} {cy + 20} {x + 44} {cy + 40} C{x + 20} {cy + 62} {x - 26} {cy + 62} {x - 50} {cy + 44} L{x - 58} {cy + 30} C{x - 40} {cy + 38} {x - 10} {cy + 40} {x + 2} {cy + 22} C{x + 12} {cy + 8} {x + 6} {cy - 14} {x - 6} {cy - 30} C{x - 12} {cy - 40} {x - 12} {cy - 52} {x - 10} {cy - 64} Z", fill="#e8a07a", stroke="#8a4a2a", sw=4))
    # 器官系（消化器系: 食道・胃・小腸・大腸）
    x = xs[5]
    body.append(path(f"M{x - 4} {cy - 90} L{x - 4} {cy - 40}", stroke="#c87a5a", sw=9))
    body.append(path(f"M{x - 4} {cy - 42} C{x + 30} {cy - 46} {x + 34} {cy - 10} {x + 4} {cy - 8} C{x - 14} {cy - 6} {x - 20} {cy - 20} {x - 8} {cy - 26}", fill="#e8a07a", stroke="#8a4a2a", sw=4))
    body.append(path(f"M{x - 46} {cy + 72} L{x - 46} {cy + 2} C{x - 46} {cy - 10} {x + 46} {cy - 10} {x + 46} {cy + 2} L{x + 46} {cy + 66}", stroke="#d9965b", sw=14))
    body.append(path(f"M{x - 28} {cy + 14} C{x - 8} {cy + 4} {x + 14} {cy + 22} {x + 28} {cy + 12} C{x + 30} {cy + 30} {x - 26} {cy + 30} {x - 26} {cy + 44} C{x - 10} {cy + 36} {x + 16} {cy + 54} {x + 28} {cy + 42} C{x + 20} {cy + 60} {x - 10} {cy + 64} {x - 20} {cy + 58}", stroke="#f0b98a", sw=8))
    body.append(ellipse(x + 30, cy - 60, 16, 10, "#9c4a2c", "#5a2a18", 2, -10))
    # 人体
    x = xs[6]
    body.append(f'  <circle cx="{x}" cy="{cy - 92}" r="20" fill="#f0c8a0" stroke="#8a5a3a" stroke-width="3"/>')
    body.append(path(f"M{x - 30} {cy - 66} L{x + 30} {cy - 66} L{x + 46} {cy + 10} L{x + 36} {cy + 12} L{x + 24} {cy - 30} L{x + 22} {cy + 30} L{x + 24} {cy + 110} L{x + 6} {cy + 110} L{x} {cy + 40} L{x - 6} {cy + 110} L{x - 24} {cy + 110} L{x - 22} {cy + 30} L{x - 24} {cy - 30} L{x - 36} {cy + 12} L{x - 46} {cy + 10} Z", fill="#f0c8a0", stroke="#8a5a3a", sw=3))
    return svg(W, H, "人体の階層の模式図。左から原子・分子（水の分子）、細胞小器官（ミトコンドリア）、細胞、組織（細胞が並んだ層）、器官（胃）、器官系（消化器系）、人体。矢印は小さい単位が集まって大きい単位をつくる向き", body)


def main():
    for name, fn in [("epithelium", epithelium), ("tissue-types", tissue_types), ("connective-tissue", connective_tissue),
                     ("muscle-tissue", muscle_tissue), ("neuron", neuron), ("neuroglia", neuroglia),
                     ("body-layers", body_layers), ("burn-depth", burn_depth), ("body-levels", levels)]:
        (OUT / f"{name}.svg").write_text(fn(), encoding="utf-8")
        print(f"content/diagrams/{name}.svg")


if __name__ == "__main__":
    main()
