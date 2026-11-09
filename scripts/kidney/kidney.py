# 腎臓の中のつくり（腎皮質・腎柱・腎錐体・腎乳頭・腎洞と、小腎杯・大腎杯・腎盤）の形を作る。
# 元の形は scripts/kidney/export.mjs が data-raw/kidney/input.json に書く（BodyParts3D の腎臓と、骨に合わせた Z-Anatomy の腎盤。m）。
# 使い方: python3 scripts/kidney/kidney.py [--check]（numpy と scipy だけを使う。--check は確かめる前頭断の画像を data-raw/kidney/ に書く＝PIL を使う）
# 出力: data-raw/kidney/parts.json（部品ごとの形。m）。scripts/kidney/index.mjs が Z-Anatomy の部品として読む（腎盤の形をもとにするので CC BY-SA）。
#
# 考え方（どれも 0.5mm のボクセルで決め、互いに重ならない形にする。3Dの断面は形の裏側を組織の色で塗るので、
# 入れ子の形にすると皮質の切り口から奥の錐体が透けて見える）:
# - 腎杯と腎盤: Z-Anatomy の腎盤の形（小腎杯・大腎杯まで1つ）の中。尿管へ続く開いた輪をふさぎ、出口からの道のり（形の中を通る距離）で分ける。
#   道のりの極大（まわり TIP_R でいちばん遠い所）が小腎杯の先（左右とも7つ）。先から MINOR までが小腎杯。
#   出口から、小腎杯でない所が2つ以上の枝に分かれる手前までが腎盤、その先が大腎杯。
# - 腎洞: 腎杯・腎盤の形を CLOSE で閉じて（枝の間を埋めて）SINUS だけ広げた範囲。腎門（出口から HILUM まで）でだけ外に出る（脂肪と血管の入る所）。
# - 腎錐体: 表面から CORTEX より深く、腎洞でない所を、どの小腎杯にいちばん近いかで分ける（小腎杯ごとに1つ）。
#   となりの錐体と取り合う所（小腎杯までの距離の差が GAP ＋ 腎洞に近いほど太くなる WIDEN より小さい所）は腎柱。
#   これで錐体は底が皮質に接し、先が腎洞へ向かう三角形になる（前頭断で教科書の図のように見える）。
# - 腎乳頭: 小腎杯の先から、腎杯の枝の向き（と腎盤の中心から先への向きの間）に PAPILLA まで。腎洞を横切って錐体の先と小腎杯をつなぐ。
# - 腎皮質: 残り。表面から CORTEX より深い所（錐体と錐体の間）は腎柱として分ける。
# - 脂肪被膜と腎筋膜（1mm の格子の距離の場の等値面）: 腎臓と副腎（腎門のくぼみは埋める）から FAT_GAP〜FAT の所が脂肪被膜、その外 FASCIA の厚さが腎筋膜。
#   腎筋膜は上と外側で閉じ、下は開いて尿管・精巣（卵巣）動静脈を通すので、腎臓の下端から FAT_BELOW より下は作らない。
#   脂肪被膜の内側の面は腎臓の表面から FAT_GAP 離す（半透明で描く形が腎臓の面とぴったり重なってちらつかないように）。
# 面は surface nets で作り Taubin 法でならす。となりの形と面がぴったり重ならないよう、境目を少し内側（LEVEL）に取る。
# 腎臓の表面にあたる点（元の面から SNAP 以内）は元の BodyParts3D の腎臓の面へ吸い付けて、ボクセルの段を消す。
import json
import os
import sys

import numpy as np
import scipy.sparse as sp
from scipy import ndimage as ndi
from scipy.sparse.csgraph import connected_components, dijkstra

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "nasal"))
from nasalseg import surface_nets, taubin  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "kidney")
H = 0.5  # ボクセルの大きさ（mm）
CORTEX = 5.0  # 腎皮質の厚さ（mm。表面から錐体の底まで）
PAPILLA = 7.0  # 腎乳頭（小腎杯の先からの長さ、mm）
SINUS = 2.5  # 腎洞（腎杯・腎盤のまわりの厚さ、mm）
CLOSE = 7.0  # 腎杯の枝の間を腎洞として埋める広さ（mm）
MINOR = 6.0  # 小腎杯（先からの道のり、mm）
TIP_R = 3.5  # 小腎杯の先を探す広さ（mm）
GAP = 1.5  # 腎柱の太さ（錐体の底のあたり、mm）
WIDEN = 12.0  # 腎洞の縁での腎柱の太さの増し分（mm）
TAPER = 1.5  # 腎柱の太さの減り方（大きいほど腎洞の近くだけ太い）
HILUM = 16.0  # 腎門（腎盤の出口からこの距離までは腎洞が表面に出てよい、mm）
FAT = 8.0  # 脂肪被膜の厚さ（mm）
FAT_GAP = 1.0  # 脂肪被膜と腎臓・副腎の表面のすき間（mm）
FASCIA = 1.5  # 腎筋膜の厚さ（mm）
CLOSE_HILUM = 12.0  # 脂肪被膜・腎筋膜で腎門のくぼみを埋める広さ（mm）
FAT_BELOW = 2.0  # 腎臓の下端からこれより下には脂肪被膜・腎筋膜を作らない（mm）
SNAP = 0.9  # 腎臓の表面にあたる面の点を元の腎臓の面へ吸い付ける距離（mm。腎皮質は 5mm あるので内側の面は動かない）
LEVEL = 0.56  # 面を取る値（0.5 だととなりの形と面が重なる）
SMOOTH = 0.8  # 面を取る前にボクセルをぼかす広さ（ボクセル）
CHECK = "--check" in sys.argv


def load(m):
    P = np.array(m["positions"], dtype=np.float64).reshape(-1, 3) * 1000.0  # mm
    F = np.array(m["indices"], dtype=np.int64).reshape(-1, 3)
    return P, F


def boundary_loops(F):
    """開いた縁（1つの三角形にしか使われない辺）をつないだ輪"""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    key = np.sort(e, 1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    open_e = e[cnt[inv.ravel()] == 1]
    nxt = {int(a): int(b) for a, b in open_e}
    loops, seen = [], set()
    for start in nxt:
        if start in seen:
            continue
        loop, v = [], start
        while v not in seen and v in nxt:
            seen.add(v)
            loop.append(v)
            v = nxt[v]
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def cap(P, F):
    """開いた輪を扇形でふさぐ（輪の重心に点を足す）。返り値 (P, F, 輪の重心のリスト)"""
    P = P.copy()
    faces = [F]
    centers = []
    for loop in boundary_loops(F):
        c = P[loop].mean(0)
        ci = len(P)
        P = np.vstack([P, c])
        centers.append(c)
        # 縁の辺 a→b（三角形の向き）に対して、ふたの三角形は b→a→c
        faces.append(np.array([[loop[(i + 1) % len(loop)], loop[i], ci] for i in range(len(loop))]))
    return P, np.concatenate(faces), centers


def voxelize(P, F, origin, shape):
    """閉じた形の中のボクセル。3つの軸の向きに光線を通し、交わる回数の偶奇の多数決（小さな穴があっても筋が出ないように）"""
    votes = np.zeros(shape, dtype=np.int8)
    G = (P - origin) / H - 0.5  # ボクセルの中心が整数
    for axis in range(3):
        u, v = [a for a in range(3) if a != axis]
        cross = np.zeros(shape, dtype=np.int16)
        tri = G[F]
        for t in tri:
            a, b, c = t
            lo = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
            hi = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
            us = np.arange(max(lo[u], 0), min(hi[u], shape[u] - 1) + 1)
            vs = np.arange(max(lo[v], 0), min(hi[v], shape[v] - 1) + 1)
            if not len(us) or not len(vs):
                continue
            UU, VV = np.meshgrid(us, vs, indexing="ij")
            # 2次元の重心座標
            d = (b[u] - a[u]) * (c[v] - a[v]) - (b[v] - a[v]) * (c[u] - a[u])
            if abs(d) < 1e-12:
                continue
            w1 = ((UU - a[u]) * (c[v] - a[v]) - (VV - a[v]) * (c[u] - a[u])) / d
            w2 = ((b[u] - a[u]) * (VV - a[v]) - (b[v] - a[v]) * (UU - a[u])) / d
            w0 = 1 - w1 - w2
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            z = w0 * a[axis] + w1 * b[axis] + w2 * c[axis]
            zi = np.ceil(z[inside]).astype(int)  # この添字から先が反対側
            ok = (zi >= 0) & (zi < shape[axis])
            idx = [None] * 3
            idx[u] = UU[inside][ok]
            idx[v] = VV[inside][ok]
            idx[axis] = zi[ok]
            np.add.at(cross, tuple(idx), 1)
        votes += (np.cumsum(cross, axis=axis) % 2).astype(np.int8)
    return votes >= 2


def voxel_graph(mask):
    """mask の中のボクセルの 26 近傍のグラフ（重みは距離 mm）。返り値 (グラフ, 添字→ボクセル)"""
    coords = np.argwhere(mask)
    index = -np.ones(mask.shape, dtype=np.int64)
    index[tuple(coords.T)] = np.arange(len(coords))
    rows, cols, ws = [], [], []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if (dx, dy, dz) <= (0, 0, 0):
                    continue
                q = coords + [dx, dy, dz]
                ok = ((q >= 0) & (q < mask.shape)).all(1)
                j = -np.ones(len(coords), dtype=np.int64)
                j[ok] = index[tuple(q[ok].T)]
                good = j >= 0
                rows.append(np.nonzero(good)[0])
                cols.append(j[good])
                ws.append(np.full(good.sum(), np.sqrt(dx * dx + dy * dy + dz * dz) * H))
    r, c, w = np.concatenate(rows), np.concatenate(cols), np.concatenate(ws)
    g = sp.coo_matrix((np.concatenate([w, w]), (np.concatenate([r, c]), np.concatenate([c, r]))), shape=(len(coords),) * 2).tocsr()
    return g, coords


def ball(r_mm):
    r = int(np.ceil(r_mm / H))
    x, y, z = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    return (x * x + y * y + z * z) * H * H <= r_mm * r_mm


def majority(labels, inside, rounds=2):
    """inside の中のボクセルを、まわり 3×3×3 でいちばん多い組織にならす（境目の孤立したボクセルが面に小さな凹凸を作らないように）"""
    values = [k for k in np.unique(labels[inside]) if k > 0]
    for _ in range(rounds):
        counts = np.stack([ndi.uniform_filter((labels == k).astype(np.float32), 3) for k in values])
        best = np.array(values, dtype=labels.dtype)[np.argmax(counts, 0)]
        labels = np.where(inside, best, labels)
    return labels


def segment(side, data):
    PK, FK = load(data["kidney"])
    PC, FC = load(data["pelvis"])
    PC, FC, outlets = cap(PC, FC)
    lo = np.minimum(PK.min(0), PC.min(0)) - 4
    hi = np.maximum(PK.max(0), PC.max(0)) + 4
    shape = tuple(np.ceil((hi - lo) / H).astype(int) + 1)
    origin = lo
    pos = lambda ijk: origin + (np.asarray(ijk) + 0.5) * H  # noqa: E731
    # ボクセルにするのに時間がかかるので、元の形が同じなら覚えたものを使う
    key = hash((PK.tobytes(), PC.tobytes(), H))
    cache = os.path.join(DIR, f"voxels-{side}.npz")
    if os.path.exists(cache) and int(np.load(cache)["key"]) == key:
        K, C = np.load(cache)["K"], np.load(cache)["C"]
    else:
        K = voxelize(PK, FK, origin, shape)
        K = ndi.binary_fill_holes(ndi.binary_opening(K, ball(0.6)))
        C = ndi.binary_fill_holes(voxelize(PC, FC, origin, shape))
        np.savez_compressed(cache, K=K, C=C, key=key)
    # 出口: ふさいだ輪の重心のうち、腎臓のいちばん外（腎門の外）にあるもの
    d_in = ndi.distance_transform_edt(K) * H  # 腎臓の中で、表面からの深さ
    d_out = ndi.distance_transform_edt(~K) * H
    outlet = min(outlets, key=lambda c: -d_out[tuple(np.clip(((c - origin) / H).astype(int), 0, np.array(shape) - 1))])
    print(f"{side}: 腎臓 {K.sum() * H**3 / 1000:.1f} mL, 腎杯と腎盤 {C.sum() * H**3 / 1000:.2f} mL, 出口 {np.round(outlet, 1)} mm, 輪 {len(outlets)}")
    # 腎杯の中の道のり
    graph, coords = voxel_graph(C)
    start = np.argmin(np.linalg.norm(pos(coords) - outlet, axis=1))
    g = dijkstra(graph, indices=start)
    gmap = np.full(shape, -np.inf)
    gmap[tuple(coords.T)] = g
    # 小腎杯の先: まわり 5mm でいちばん遠く、出口から 20mm 以上
    peak = ndi.maximum_filter(gmap, footprint=ball(TIP_R), mode="constant", cval=-np.inf)
    is_tip = C & (gmap >= peak) & (gmap > 15)
    lab, n = ndi.label(is_tip, structure=np.ones((3, 3, 3)))
    tips = [np.argwhere(lab == i + 1).mean(0) for i in range(n)]
    tip_idx = [int(np.argmin(np.linalg.norm(coords - t, axis=1))) for t in tips]
    print(f"{side}: 小腎杯の先 {len(tips)} 個 道のり {[round(float(g[i]), 1) for i in tip_idx]}")
    gt = dijkstra(graph, indices=tip_idx)  # 先ごとの道のり
    near_tip = gt.argmin(0)
    d_tip = gt.min(0)
    calyx = np.zeros(shape, dtype=np.int8)  # 1=腎盤 2=大腎杯 3=小腎杯
    minor = d_tip <= MINOR
    # 腎盤: 出口から、小腎杯でない所が2つ以上に分かれる手前まで
    split = None
    for t in np.arange(4, g.max(), 0.5):
        rest = (~minor) & (g > t)
        sub = graph[rest][:, rest]
        k, labels = connected_components(sub, directed=False)
        sizes = np.bincount(labels)
        if (sizes > 40).sum() >= 2:
            split = t
            break
    pelvis = (~minor) & (g <= split)
    calyx[tuple(coords[pelvis].T)] = 1
    calyx[tuple(coords[(~minor) & (~pelvis)].T)] = 2
    calyx[tuple(coords[minor].T)] = 3
    print(f"{side}: 腎盤は出口から {split} mm まで")

    # 錐体の向き（腎乳頭を伸ばす向き）: 小腎杯の先の 6〜10mm 手前から先への向きと、腎盤の中心から先への向きの間
    apex, axis_n = [], []
    for k, ti in enumerate(tip_idx):
        a = pos(coords[ti])
        back = (gt[k] > 6) & (gt[k] < 10)
        b = a - pos(coords[back]).mean(0)
        c = a - pos(coords[pelvis]).mean(0)  # 腎盤の中心から先への向き
        n_ = b / np.linalg.norm(b) + c / np.linalg.norm(c)
        apex.append(a)
        axis_n.append(n_ / np.linalg.norm(n_))
    apex, axis_n = np.array(apex), np.array(axis_n)
    inner = K & ~C
    ii = tuple(np.argwhere(inner).T)
    P = pos(np.argwhere(inner))
    dist = []
    for k in range(len(tip_idx)):
        m = np.zeros(shape, dtype=bool)
        m[tuple(coords[minor & (near_tip == k)].T)] = True
        dist.append((ndi.distance_transform_edt(~m) * H)[ii])
    dist = np.stack(dist, 1)
    order = np.argsort(dist, 1)
    best = order[:, 0]
    d1 = dist[np.arange(len(P)), best]
    d2 = dist[np.arange(len(P)), order[:, 1]]
    V = P - apex[best]
    reach = np.linalg.norm(V, axis=1)
    cosang = (V * axis_n[best]).sum(1) / (reach + 1e-9)
    # 腎洞: 腎杯・腎盤の形を CLOSE mm で閉じ（枝の間を埋め）、SINUS mm 広げた範囲（腎臓の中だけ）
    d_c = ndi.distance_transform_edt(~C) * H
    E = (ndi.distance_transform_edt(d_c <= CLOSE) * H > CLOSE - SINUS) & K
    d_e = (ndi.distance_transform_edt(~E) * H)[ii]
    deep = d_in[ii] > CORTEX
    # 腎洞の縁（0）から錐体の底（1）までの割合。腎柱は腎洞の近くで太く、錐体の底で細い（錐体がくさび形になる）
    f = np.clip(d_e / np.maximum(d_e + d_in[ii] - CORTEX, 1e-6), 0, 1)
    width = GAP + WIDEN * (1 - f) ** TAPER
    pyr = (d2 - d1 > width) & deep & ~E[ii]
    # 腎乳頭: 小腎杯の先から錐体の向きに、腎洞を横切って錐体につながる所と、錐体の先
    pap = (cosang >= np.cos(np.radians(38))) & (reach <= PAPILLA) & (d2 - d1 > 2.0) & (E[ii] | pyr)
    pyr |= pap
    # 腎洞は腎門（出口のまわり HILUM）でだけ表面に出る。ほかで表面から 2mm より浅い所は腎皮質にする
    hilum = np.linalg.norm(P - outlet, axis=1) <= HILUM
    sinus = (~pyr) & E[ii] & ((d_in[ii] > 2.0) | hilum)
    col = (~pyr) & (~sinus) & deep
    tissue = np.zeros(shape, dtype=np.int8)  # 1=皮質 2=腎柱 3=錐体 4=乳頭 5=腎洞
    tissue[ii] = np.where(pap, 4, np.where(pyr, 3, np.where(sinus, 5, np.where(col, 2, 1))))
    tissue = majority(tissue, inner)
    which = np.full(shape, -1, dtype=np.int16)
    which[ii] = np.where(pyr, best, -1)
    for name, k in [("皮質", 1), ("腎柱", 2), ("錐体", 3), ("乳頭", 4), ("腎洞", 5)]:
        print(f"{side}: {name} {(tissue == k).sum() * H**3 / 1000:.2f} mL")
    return dict(origin=origin, shape=shape, K=K, C=C, calyx=calyx, tissue=tissue, which=which, apex=apex, axis=axis_n)


def check_images(side, seg):
    from PIL import Image

    colors = {1: (226, 170, 150), 2: (205, 140, 125), 3: (150, 60, 60), 4: (110, 30, 40), 5: (240, 220, 120)}
    ccol = {1: (60, 120, 200), 2: (90, 170, 230), 3: (150, 210, 250)}
    tissue, calyx = seg["tissue"], seg["calyx"]
    nz = tissue.shape[2]
    for frac in (0.35, 0.5, 0.65):
        z = int(nz * frac)
        img = np.full(tissue.shape[:2] + (3,), 250, dtype=np.uint8)
        for k, c in colors.items():
            img[tissue[:, :, z] == k] = c
        for k, c in ccol.items():
            img[calyx[:, :, z] == k] = c
        im = Image.fromarray(np.transpose(img, (1, 0, 2))[::-1])  # x→右、y→上
        im = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
        im.save(os.path.join(DIR, f"check-{side}-z{int(frac * 100)}.png"))


def envelope(data):
    """脂肪被膜と腎筋膜の面（m）。腎臓と副腎（腎門のくぼみは CLOSE_HILUM で埋める）からの距離の場の等値面で、
    ボクセルの段が出ないようにする。返り値 {"fat": (P, F), "fascia": (P, F)}"""
    h = 1.0
    PK, FK = load(data["kidney"])
    PA, FA = load(data["adrenal"])
    pad = FAT + FASCIA + CLOSE_HILUM + 4
    lo = np.minimum(PK.min(0), PA.min(0)) - pad
    hi = np.maximum(PK.max(0), PA.max(0)) + pad
    shape = tuple(np.ceil((hi - lo) / h).astype(int) + 1)
    global H
    keep, H = H, h
    try:
        inside = ndi.binary_fill_holes(voxelize(PK, FK, lo, shape) | voxelize(PA, FA, lo, shape))
    finally:
        H = keep
    # 閉じる（腎門のくぼみと、腎臓と副腎の間を埋める）
    grown = ndi.distance_transform_edt(~inside) * h <= CLOSE_HILUM
    inside = ndi.distance_transform_edt(grown) * h > CLOSE_HILUM
    d = ndi.gaussian_filter(ndi.distance_transform_edt(~inside) * h - ndi.distance_transform_edt(inside) * h, 1.2)
    y = lo[1] + (np.arange(shape[1]) + 0.5) * h
    cut = np.broadcast_to((y - (PK[:, 1].min() - FAT_BELOW))[None, :, None], shape)
    out = {}
    for slug, inner, outer in (("fat", FAT_GAP, FAT), ("fascia", FAT, FAT + FASCIA)):
        field = np.minimum(np.minimum(d - inner, outer - d), cut)
        v, faces = surface_nets(np.pad(field, 1, constant_values=-1), 0.0)
        v = taubin(v, faces, iterations=10)
        out[slug] = ((lo + (v - 1 + 0.5) * h) / 1000.0, faces)
    return out


def closest_on_triangles(P, A, B, C):
    """点 P[i] から三角形 (A[i], B[i], C[i]) の上のいちばん近い点（Ericson の方法を配列で）"""
    ab, ac, ap = B - A, C - A, P - A
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = P - B
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = P - C
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    denom = np.where(va + vb + vc == 0, 1e-12, va + vb + vc)
    v, w = vb / denom, vc / denom
    out = A + ab * v[:, None] + ac * w[:, None]
    # 辺と頂点の場合
    cases = [
        ((d1 <= 0) & (d2 <= 0), A),
        ((d3 >= 0) & (d4 <= d3), B),
        ((d6 >= 0) & (d5 <= d6), C),
    ]
    t_ab = np.clip(d1 / np.where(d1 - d3 == 0, 1e-12, d1 - d3), 0, 1)
    t_ac = np.clip(d2 / np.where(d2 - d6 == 0, 1e-12, d2 - d6), 0, 1)
    t_bc = np.clip((d4 - d3) / np.where((d4 - d3) + (d5 - d6) == 0, 1e-12, (d4 - d3) + (d5 - d6)), 0, 1)
    edge_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    edge_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    edge_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    out = np.where(edge_bc[:, None], B + (C - B) * t_bc[:, None], out)
    out = np.where(edge_ac[:, None], A + ac * t_ac[:, None], out)
    out = np.where(edge_ab[:, None], A + ab * t_ab[:, None], out)
    for mask, Q in reversed(cases):
        out = np.where(mask[:, None], Q, out)
    return out


def snap(V, PK, FK, reach=SNAP):
    """面の点のうち、元の腎臓の面から reach mm 以内のものを元の面の上へ動かす（ボクセルの段を消して元の形に戻す）"""
    from scipy.spatial import cKDTree
    A, B, C = PK[FK[:, 0]], PK[FK[:, 1]], PK[FK[:, 2]]
    tree = cKDTree((A + B + C) / 3)
    _, cand = tree.query(V, k=12)
    best = np.full(len(V), np.inf)
    out = V.copy()
    for j in range(cand.shape[1]):
        t = cand[:, j]
        q = closest_on_triangles(V, A[t], B[t], C[t])
        d = np.linalg.norm(q - V, axis=1)
        better = d < best
        best[better] = d[better]
        out[better] = q[better]
    near = best <= reach
    V = V.copy()
    V[near] = out[near]
    return V, near.sum()


# 部品: (ID の末尾, 名前, どの配列, 値)。名前は Z-Anatomy の部品と同じく左右を前に付ける
PARTS = [
    ("cortex", "renal cortex", "tissue", 1),
    ("column", "renal column", "tissue", 2),
    ("pyramid", "renal pyramid", "tissue", 3),
    ("papilla", "renal papilla", "tissue", 4),
    ("sinus", "renal sinus", "tissue", 5),
    ("pelvis", "renal pelvis proper", "calyx", 1),
    ("major", "major renal calyx", "calyx", 2),
    ("minor", "minor renal calyx", "calyx", 3),
]


def surface(mask, origin, h=H, outer=None):
    """ボクセルの集まりの面（m。h はボクセルの大きさ mm）。小さなかけら（三角形 60 未満）は捨てる。
    outer＝(元の腎臓の点, 三角形)（mm）を渡すと、腎臓の表面にあたる点を元の面へ吸い付ける"""
    f = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), SMOOTH)
    v, faces = surface_nets(f, LEVEL)
    v = taubin(v, faces, iterations=10)
    if outer is not None:
        mm = origin + (v - 2 + 0.5) * h
        mm, _ = snap(mm, *outer)
        v = (mm - origin) / h + 2 - 0.5
    n = len(v)
    adj = sp.coo_matrix((np.ones(len(faces) * 3), (np.repeat(faces[:, 0], 3), faces.ravel())), shape=(n, n))
    k, comp = connected_components(adj, directed=False)
    size = np.bincount(comp[faces[:, 0]], minlength=k)
    faces = faces[size[comp[faces[:, 0]]] >= 60]
    used = np.unique(faces)
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    P = (origin + (v[used] - 2 + 0.5) * h) / 1000.0
    return P, remap[faces]


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    parts = []
    for side in ("right", "left"):
        seg = segment(side, data[side])
        if CHECK:
            check_images(side, seg)
        kidney = load(data[side]["kidney"])
        for slug, name, array, value in PARTS:
            P, F = surface(seg[array] == value, seg["origin"], outer=kidney if array == "tissue" else None)
            parts.append({"id": f"ZK_{slug}_{side[0]}", "name": f"{side} {name}", "positions": np.round(P, 6).ravel().tolist(), "indices": F.ravel().tolist()})
            print(f"{side} {name}: {len(P)} 点 {len(F)} 三角形")
        shells = envelope(data[side])
        for slug, name in (("fat", "perirenal fat capsule"), ("fascia", "renal fascia")):
            P, F = shells[slug]
            parts.append({"id": f"ZK_{slug}_{side[0]}", "name": f"{side} {name}", "positions": np.round(P, 6).ravel().tolist(), "indices": F.ravel().tolist()})
            print(f"{side} {name}: {len(P)} 点 {len(F)} 三角形")
    json.dump({"version": 1, "parts": parts}, open(os.path.join(DIR, "parts.json"), "w"))


if __name__ == "__main__":
    main()
