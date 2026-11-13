"""臓器の図「細胞と組織」の平面図の元の図を作る。
Wikimedia Commons の自由なライセンスの図（OpenStax『Anatomy & Physiology』・Blausen・Riveromonicadaniela）から、
焼き込まれた英語の文字と引き出し線を消し、要る所だけを切り出し（いくつかの図は並べ直し）、content/diagrams/*.png に書く。
名前はアプリがラベルで付けるので、文字は残さない。ラベルの点は content/organs.json の tissues に、ここで書いた画像のピクセルで書く。
SVG の図（細胞・注射・熱傷）は scripts/plates.mjs がそのまま文字を抜くので、ここでは扱わない。

文字と引き出し線の消し方: 黒に近い灰色（OpenStax・Blausen の文字と線の色）のつながった点のかたまりのうち、
まわりの多くが白いもの（白地の上の文字と線）を、少し太らせてまわりの色で埋める。図の枠のような長い線は残す（max_len）。
使い方: python3 scripts/diagrams/tissue-art.py [図ID…]（無ければ全部）。元の図は data-raw/plate-art/ に取り置く（無ければ取り寄せる）
"""
import hashlib
import subprocess
import sys
import urllib.parse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "data-raw" / "plate-art"
OUT = ROOT / "content" / "diagrams"


def commons_url(name):
    name = name.replace(" ", "_")
    h = hashlib.md5(name.encode()).hexdigest()
    return f"https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{urllib.parse.quote(name)}"


def load(name):
    """元の図（Commons のファイル名）を読む。白地に重ねて RGB の配列にする"""
    path = ART / name.replace(" ", "_")
    if not path.exists():
        ART.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-sfL", "-m", "120", "-A", "anatomy-app-plates/1.0 (https://github.com/9hckg4shj6-glitch/anatomy-app)",
                        "-o", str(path), commons_url(name)], check=True)
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        back = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(back, im)
    return np.asarray(im.convert("RGB")).astype(np.float32)


def inpaint(a, mask):
    """mask の点を、まわりの埋めない点の平均で外から順に埋める"""
    a = a.copy()
    mask = mask.copy()
    kernel = np.ones((3, 3))
    while mask.any():
        known = ~mask
        total = np.stack([ndimage.convolve(a[..., c] * known, kernel, mode="nearest") for c in range(3)], -1)
        count = ndimage.convolve(known.astype(np.float32), kernel, mode="nearest")
        edge = mask & (count > 0)
        if not edge.any():
            break
        a[edge] = total[edge] / count[edge][:, None]
        mask &= ~edge
    return a


def sample(a, x, y):
    """配列の点 (x, y) の色（双線形）"""
    H, W = a.shape[:2]
    x, y = np.clip(x, 0, W - 1.001), np.clip(y, 0, H - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
            + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)


def line_mask(mask, q0, q1, half, extend=5):
    """線分 q0–q1 から half の内側の点に印を付ける"""
    H, W = mask.shape
    length = np.hypot(*(q1 - q0))
    u = (q1 - q0) / length
    n = np.array([-u[1], u[0]])
    ts = np.arange(-extend, length + extend + 0.5, 0.5)
    for k in np.arange(-half, half + 0.01, 0.5):
        x, y = (q0[None, :] + ts[:, None] * u[None, :] + n * k).T
        xi, yi = np.round(x).astype(int), np.round(y).astype(int)
        ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
        mask[yi[ok], xi[ok]] = True


def dir_inpaint(a, mask, reach=16, steps=24):
    """mask の点を、steps の向きのそれぞれで両側の埋めない点まで進み、両端の色が最も近い（近い方を少し優先）向きで間を補って埋める。
    線が横切った線維・輪郭は、その向きにつながる（scripts/plates.mjs の引き出し線の消し方と同じ）。両側が見つからない点はまわりの平均で"""
    H, W = mask.shape
    ys, xs = np.nonzero(mask)
    best = np.full(len(ys), np.inf)
    color = np.zeros((len(ys), 3), np.float32)
    for i in range(steps):
        ang = np.pi * i / steps
        d = np.array([np.cos(ang), np.sin(ang)])
        ends = []
        for sgn in (1, -1):
            found = np.zeros(len(ys), int)
            at = np.zeros((len(ys), 2), int)
            for t in range(1, reach + 1):
                xx = np.round(xs + sgn * d[0] * t).astype(int)
                yy = np.round(ys + sgn * d[1] * t).astype(int)
                inside = (xx >= 0) & (xx < W) & (yy >= 0) & (yy < H)
                free = np.zeros(len(ys), bool)
                free[inside] = ~mask[yy[inside], xx[inside]]
                new = free & (found == 0)
                found[new] = t
                at[new] = np.stack([xx[new], yy[new]], 1)
            ends.append((found, at))
        (fa, pa), (fb, pb) = ends
        ok = (fa > 0) & (fb > 0)
        ca = a[pa[:, 1], pa[:, 0]]
        cb = a[pb[:, 1], pb[:, 0]]
        score = np.abs(ca - cb).sum(1) + 2 * (fa + fb)
        better = ok & (score < best)
        w = (fa / np.maximum(fa + fb, 1))[:, None]
        color[better] = (ca * (1 - w) + cb * w)[better]
        best[better] = score[better]
    out = a.copy()
    done = np.isfinite(best)
    out[ys[done], xs[done]] = color[done]
    rest = np.zeros_like(mask)
    rest[ys[~done], xs[~done]] = True
    return inpaint(out, rest) if rest.any() else out


def masks(a, dark):
    hi, lo = a.max(-1), a.min(-1)
    neutral = hi - lo < 45
    ink = (hi < dark) & neutral
    gray = hi - lo < 18  # 文字のにじみの灰色（図の薄い灰緑などは入れない）
    art = (lo <= 215) & ~ink & ~(ndimage.binary_dilation(ink, iterations=2) & gray)
    return ink, ndimage.binary_dilation(art, iterations=4)


def segments(points, tol=2.2, min_len=25):
    """点の集まりを、まっすぐな線分の組に分ける（いちばん離れた2点を結ぶ線から外れた点で分け直す）"""
    out = []
    stack = [points]
    while stack:
        pts = stack.pop()
        if len(pts) < min_len:
            continue
        # いちばん離れた2点（端から最も遠い点、そこから最も遠い点）
        p0 = pts[np.argmax(((pts - pts[0]) ** 2).sum(1))]
        p1 = pts[np.argmax(((pts - p0) ** 2).sum(1))]
        d = p1 - p0
        length = np.hypot(*d)
        if length < min_len:
            continue
        n = np.array([-d[1], d[0]]) / length
        off = np.abs((pts - p0) @ n)
        if (off <= tol).mean() > 0.97:
            out.append((p0.astype(float), p1.astype(float)))
            continue
        on = off <= tol
        if on.sum() >= min_len:
            q = pts[on]
            t = (q - p0) @ (d / length)
            out.append((p0 + d / length * t.min(), p0 + d / length * t.max()))
        stack.append(pts[~on])
    return out


def erase_ink(a, dark=105, max_len=420, near=0.35, keep=(), force=(), region=None, whiten=True, lines=True, reach=160, min_line=25, tol=2.2, segs=(), half=3.5, specks=0):
    """文字と引き出し線を消す。
    文字: 黒に近い灰色の点を2点太らせてつないだかたまり（語）のうち、図の色の近く（4点以内）にある点の割合が near より少ないものを、まわりの色で埋める。
    図の輪郭の線は図の色のすぐ隣にあるので残る。図の色は白でない点から、文字のにじみ（文字の近くの無彩色の点）を除いたもの。
    引き出し線（lines）: 図から離れた黒い点を、まっすぐな線分に分け、その向きに黒い点が続くかぎり（reach まで）図の上へものばして消す
    （図の輪郭とつながっていても線だけを消せる）。線は白いふちどりごと消す。
    max_len より長いもの（図の枠）は残す。keep の四角に中心のあるものは残し、force の四角の中の黒い点はみな消す（図の輪郭とつながった文字）。
    region があればその中だけ。whiten なら、白に近い灰色（消した文字のにじみ・JPEG のむら）を白にする"""
    ink, by_art = masks(a, dark)
    if region:
        x0, y0, x1, y1 = region
        inside = np.zeros_like(ink)
        inside[y0:y1, x0:x1] = True
        ink &= inside
    H, W = ink.shape
    inbox = lambda cx, cy, boxes: any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in boxes)
    blob = ndimage.binary_dilation(ink, iterations=2)
    labels, _ = ndimage.label(blob, structure=np.ones((3, 3)))
    erase = np.zeros_like(ink)
    for i, sl in enumerate(ndimage.find_objects(labels), 1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        if inbox(cx, cy, keep):
            continue
        comp = labels[sl] == i
        core = comp & ink[sl]
        if max(h, w) > max_len or comp.sum() / max(h, w) < 8:
            continue  # 枠や線（線は下で）
        if by_art[sl][core].mean() >= near:
            continue
        erase[sl] |= comp
    for x0, y0, x1, y1 in force:
        erase[y0:y1, x0:x1] |= blob[y0:y1, x0:x1]
    fills = []
    if lines:
        free = ink & ~by_art & ~erase
        lab, _ = ndimage.label(free, structure=np.ones((3, 3)))
        for i, sl in enumerate(ndimage.find_objects(lab), 1):
            if max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) > max_len:
                continue  # 図の枠
            ys, xs = np.nonzero(lab[sl] == i)
            pts = np.stack([xs + sl[1].start, ys + sl[0].start], 1)
            for p0, p1 in segments(pts, tol, min_line):
                if np.hypot(*(p1 - p0)) > max_len or inbox(*(p0 + p1) / 2, keep):
                    continue
                u = (p1 - p0) / np.hypot(*(p1 - p0))
                n = np.array([-u[1], u[0]])
                ends = []
                for p, s in ((p0, -1), (p1, 1)):
                    last, gap = 0, 0
                    for t in range(1, reach):
                        q = p + s * u * t
                        hit = any(0 <= int(round(y)) < H and 0 <= int(round(x)) < W and ink[int(round(y)), int(round(x))]
                                  for x, y in (q + n * k for k in (-1.5, -0.75, 0, 0.75, 1.5)))
                        if hit:
                            last, gap = t, 0
                        else:
                            gap += 1
                            if gap > 2:
                                break
                    ends.append(p + s * u * last)
                fills.append(tuple(ends))
    # 書いた線分（図の上を通る引き出し線）: 端を ±6 点の範囲で、線にそって最も暗くなる所へ合わせ直して消す。
    # 線は half の幅で、両側の色が最も近い向きで補って埋める
    dark_of = lambda q0, q1: sum(765 - a[int(round(y)), int(round(x))].sum() for x, y in (q0 + (q1 - q0) * t for t in np.linspace(0, 1, 60))
                                 if 0 <= int(round(y)) < H and 0 <= int(round(x)) < W)
    for seg in segs:
        x0, y0, x1, y1 = seg[:4]
        if len(seg) > 4 and not seg[4]:  # 合わせ直さない（楕円を折れ線で消すときなど）
            fills.append((np.array([x0, y0], float), np.array([x1, y1], float)))
            continue
        best = max(((np.array([x0 + i, y0 + j], float), np.array([x1 + k, y1 + l], float))
                    for i in range(-6, 7, 2) for j in range(-6, 7, 2) for k in range(-6, 7, 2) for l in range(-6, 7, 2)),
                   key=lambda pair: dark_of(*pair))
        best = max(((best[0] + (i, j), best[1] + (k, l)) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) for l in (-1, 0, 1)),
                   key=lambda pair: dark_of(*pair))
        fills.append(best)
    out = inpaint(a, erase)
    if fills:
        lm = np.zeros(erase.shape, bool)
        for q0, q1 in fills:
            line_mask(lm, q0, q1, half)
        out = dir_inpaint(out, lm, reach=int(2 * half + 8))
    if specks:
        # 線を消した残りの小さな黒い点（specks 点以下のかたまり）
        hi, lo = out.max(-1), out.min(-1)
        dots, _ = ndimage.label((hi < 70) & (hi - lo < 45), structure=np.ones((3, 3)))
        sizes = ndimage.sum(np.ones_like(hi), dots, index=np.arange(1, dots.max() + 1))
        small = np.isin(dots, np.nonzero(sizes <= specks)[0] + 1)
        if small.any():
            out = dir_inpaint(out, ndimage.binary_dilation(small, iterations=2))
    if whiten:
        hi, lo = out.max(-1), out.min(-1)
        out[(lo > 212) & (hi - lo < 14)] = 255
    return out


def fill(a, boxes, color=(255, 255, 255)):
    """四角を平らに塗る（文字の残り・表の罫線など）"""
    a = a.copy()
    for x0, y0, x1, y1 in boxes:
        a[y0:y1, x0:x1] = color
    return a


def patch(a, boxes):
    """四角をまわりの色で埋める"""
    mask = np.zeros(a.shape[:2], bool)
    for x0, y0, x1, y1 in boxes:
        mask[y0:y1, x0:x1] = True
    return inpaint(a, mask)


def canvas(w, h):
    return np.full((h, w, 3), 255, np.float32)


def paste(dst, src, box, at):
    x0, y0, x1, y1 = box
    piece = src[y0:y1, x0:x1]
    dst[at[1]:at[1] + piece.shape[0], at[0]:at[0] + piece.shape[1]] = piece


def save(a, name, scale=None):
    """長い辺を 1600 までに縮めて（scale があればその倍率で）PNG に書く。ラベルの点はこの画像のピクセルで書く"""
    OUT.mkdir(parents=True, exist_ok=True)
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    scale = scale or min(1, 1600 / max(im.size))
    if scale != 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    im.save(OUT / f"{name}.png", optimize=True)
    a = np.asarray(im)
    print(f"{name}.png {a.shape[1]}×{a.shape[0]}")


# ---- 図ごとの作り方 ----

def body_levels():
    a = load("101 Levels of Org in Body.jpg")
    # 器官系の段の体の輪郭の線も引き出し線と一緒に消える（下の端に残るかけらは force で消す）
    save(erase_ink(a, max_len=380, force=[(350, 1215, 400, 1250), (605, 1215, 655, 1250)]), "body-levels")


def tissue_types():
    # 引き出し線は残す（線の先の器官を、文字の代わりにラベルで示す）
    a = load("401 Types of Tissue.jpg")
    save(erase_ink(a, lines=False, force=[(120, 460, 200, 490)]), "tissue-types")


def epithelium():
    # OpenStax の表（上皮の種類のまとめ）の左の列の絵から6つを切り出し、基底膜の高さをそろえて 3×2 に並べ、1.5倍にする。
    # 上の段 単層扁平・単層立方・単層円柱、下の段 重層扁平・多列線毛・移行上皮（重層立方・重層円柱は使わない）
    a = load("423 Table 04 02 Summary of Epithelial Tissue CellsN.jpg")
    # （上の端, 基底膜の下の端）。左右は x 74〜320
    rows = [[(84, 107), (202, 248), (331, 480)], [(779, 866), (559, 705), (1333, 1458)]]
    below, x0, x1, gap, margin, row_gap = 32, 74, 320, 50, 30, 70
    width = 3 * (x1 - x0) + 2 * gap + 2 * margin
    tops, y = [], margin
    for row in rows:
        up = max(bm - top for top, bm in row)
        tops.append(y + up)
        y += up + below + row_gap
    out = canvas(width, y - row_gap + margin)
    for r, row in enumerate(rows):
        for c, (top, bm) in enumerate(row):
            at = (margin + c * (x1 - x0 + gap), tops[r] - (bm - top))
            paste(out, a, (x0, top, x1, bm + below), at)
            print(f"  {r}{c} 左上 {at[0] * 1.5:.0f},{at[1] * 1.5:.0f} 基底膜 y={tops[r] * 1.5:.0f}")
    big = Image.fromarray(out.astype(np.uint8)).resize((round(out.shape[1] * 1.5), round(out.shape[0] * 1.5)), Image.LANCZOS)
    save(np.asarray(big).astype(np.float32), "epithelium")


def loose_ct():
    # OpenStax「Connective Tissue」の左の絵（疎性結合組織）だけ。絵の上を通る引き出し線を消して切り出す
    a = load("408 Connective Tissue.jpg")
    a = erase_ink(a, lines=False, segs=[
        (150, 23, 250, 23), (150, 80, 262, 80), (262, 80, 302, 115), (262, 80, 385, 102), (150, 135, 217, 135),
        (150, 193, 165, 193), (165, 193, 190, 226), (165, 193, 252, 215), (150, 248, 285, 248), (285, 248, 335, 203),
        (285, 248, 493, 179), (150, 304, 337, 304), (150, 361, 338, 361), (338, 361, 492, 316)], whiten=False, specks=40)
    save(a[:, 158:595], "loose-connective-tissue", scale=2)


def cartilage():
    # OpenStax「Types of Cartilage」の左の列の絵（硝子軟骨・線維軟骨・弾性軟骨）を切り出し、引き出し線を消して横に並べる
    a = load("412 Types of Cartilage-new.jpg")
    panels = [
        (10, [(464, 150, 728, 150), (464, 150, 232, 230), (464, 150, 402, 228), (630, 488, 728, 488)]),
        (777, [(680, 176, 728, 176), (566, 480, 728, 480)]),
        (1543, [(564, 264, 728, 214), (520, 464, 728, 464), (610, 464, 504, 560)]),
    ]
    size, gap, margin = 728, 60, 20
    out = canvas(3 * size + 2 * gap + 2 * margin, size + 2 * margin)
    for i, (y0, segs) in enumerate(panels):
        panel = erase_ink(a[y0:y0 + size, 10:10 + size], lines=False, segs=segs, whiten=False, half=6, specks=200)
        paste(out, panel, (0, 0, size, size), (margin + i * (size + gap), margin))
    save(out, "cartilage")


def compact_bone():
    # 引き出し線とかっこは書いた線分で消す
    a = load("605 Compact Bone.jpg")
    segs = [(128, 22, 165, 22), (165, 22, 196, 80), (139, 72, 155, 104), (322, 33, 408, 33), (270, 87, 408, 87),
            (762, 131, 669, 178), (762, 131, 578, 282), (762, 131, 714, 280), (824, 193, 762, 285),
            (1029, 246, 914, 246), (914, 246, 811, 360), (1029, 284, 929, 284), (929, 284, 829, 355),
            (1029, 330, 974, 330), (974, 330, 829, 368), (974, 330, 820, 388), (1027, 376, 974, 404),
            (1031, 437, 1051, 443), (1051, 443, 820, 775), (800, 770, 820, 775), (964, 608, 942, 603),
            (294, 620, 294, 640), (294, 640, 714, 794), (714, 770, 714, 798), (524, 726, 524, 750),
            (279, 267, 369, 305), (279, 267, 369, 340), (212, 338, 284, 352), (199, 367, 267, 387),
            (172, 445, 239, 445), (202, 470, 286, 470), (229, 545, 397, 420), (209, 595, 359, 557),
            (182, 637, 426, 575), (304, 680, 429, 605), (304, 680, 439, 625), (354, 712, 439, 660), (404, 740, 454, 665)]
    # 骨単位を囲む楕円（中心 700,333・半径 116×57。少しずらした輪でも消して残りを無くす）も消す
    for cx, cy, rx, ry in ((700, 333, 116, 57), (697, 330, 119, 59)):
        ring = [(cx + rx * np.cos(t), cy + ry * np.sin(t)) for t in np.linspace(0, 2 * np.pi, 73)]
        segs += [(*p, *q, 0) for p, q in zip(ring, ring[1:])]
    save(erase_ink(a, segs=segs, whiten=False, half=3, specks=30), "compact-bone")


def blood():
    # 表の枠も消す（細胞だけを残す）
    a = load("Blausen 0425 Formed Elements.png")
    save(erase_ink(a, max_len=3000, specks=40), "blood-cells")


def neuron():
    a = load("1206 The Neuron.jpg")
    save(erase_ink(a), "neuron")


def glia_cns():
    a = load("1209 Glial Cells of the CNS-02.jpg")
    # 小膠細胞（ミクログリア）は黒い細かい突起で描かれているので残す。星状膠細胞の細い突起の輪郭を線と取らないよう、線は長いものだけ
    save(erase_ink(a, keep=[(175, 20, 275, 110), (320, 280, 400, 380)], force=[(268, 604, 440, 634)], segs=[(147, 553, 270, 614), (165, 617, 270, 617)], min_line=45, tol=1.6), "neuroglia-cns")


def glia_pns():
    a = load("1210 Glial Cells of the PNS.jpg")
    save(erase_ink(a), "neuroglia-pns")


def muscle():
    a = load("Muscle Tissue Cells.png")
    save(a, "muscle-tissue")


STEPS = {
    "body-levels": body_levels,
    "tissue-types": tissue_types,
    "epithelium": epithelium,
    "loose-connective-tissue": loose_ct,
    "cartilage": cartilage,
    "compact-bone": compact_bone,
    "blood-cells": blood,
    "neuron": neuron,
    "neuroglia-cns": glia_cns,
    "neuroglia-pns": glia_pns,
    "muscle-tissue": muscle,
}

if __name__ == "__main__":
    only = sys.argv[1:]
    for key, step in STEPS.items():
        if not only or key in only:
            step()
