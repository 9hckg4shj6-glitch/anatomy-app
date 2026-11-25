# 耳の中のつくり（骨迷路と膜迷路・鼓室・外耳道・耳管の骨部）の形を作る。
# 元の形は scripts/ear/export.mjs が data-raw/ear/input.json に書く（骨に合わせた Z-Anatomy の蝸牛・前庭・耳小骨・鼓膜・耳管と、
# BodyParts3D の側頭骨・外耳。m）。
# 使い方: python3 scripts/ear/ear.py [--check]（numpy と scipy だけを使う。--check は確かめる絵を data-raw/ear/ に書く＝PIL を使う）
# 出力: data-raw/ear/parts.json（部品ごとの形。m）。scripts/ear/index.mjs が Z-Anatomy の部品として読む
# （Z-Anatomy の迷路の形をもとにするので CC BY-SA 4.0。Z-Anatomy の GLB に入る）。
#
# 考え方（左の耳は左右を反転して右と同じ手順で作り、できた形を反転して戻す）:
# - 骨迷路: Z-Anatomy の「前庭」は前庭と3つの半規管が1つの形、「蝸牛」は蝸牛のらせんの管。2つは蝸牛の根もとの輪でつながっている。
#   どちらも骨の中の空所（外リンパの入る所）の形なので、それを 0.1mm のボクセルにして分ける。
#   - 前庭と半規管: 壁からの距離が CORE より大きい所（前庭の芯）から形の中を GROW だけ広げ、その外に残る管を半規管とする。
#     管のかたまりは2つ（外側半規管と、総脚でつながった前・後半規管）。前・後は2つの平面に交互に当てはめて分け（上にある方が前）、
#     両方の平面に近い所のうち上のかたまりを総脚とする。前庭の芯と管の間は、どちらに近いか（形の中の道のり）で分ける。
#   - 膨大部: 半規管の両端のうち太い方の端。
#   - 蝸牛: 前庭との境の輪からの道のり（形の中を通る距離）で中心線を引き、らせんの軸（中心線の平面の法線）を求める。
#     管の断面の中で、軸の向き（頂の側）に LAMINA より上を前庭階、下を鼓室階とし（骨ラセン板と基底板の高さ）、
#     前庭階のうち外側の壁に寄った三角形（前庭膜の線より下）を蝸牛管とする。頂の HELICO（蝸牛孔）には蝸牛管を作らない。
# - 膜迷路（模式の形。実物では骨迷路より細い）:
#   - 半規管の膜（半規管）: 骨の管の中心線を外のふち（円の外側）へ寄せた道に、骨の管の DUCT の太さの管。膨大部では太く（膜膨大部）、
#     その内側の壁に横向きの高まり（膨大部稜）を作る。前・後半規管の膜は総脚の中を通って（膜の総脚）卵形嚢へ入る。
#   - 卵形嚢: 前庭の後上の、半規管が開く所の近くの細長い袋。球形嚢: 前庭の前下の、蝸牛の入口に近い丸い袋。どちらも骨の壁から WALL 離す。
# - 前庭窓: Z-Anatomy の前庭の、アブミ骨底のはまる穴（開いた輪）をふさぐ薄い板。蝸牛窓: 蝸牛の根もとの鼓室階の壁のうち、
#   鼓室にいちばん近い所の丸い薄い板。
# - 鼓室（0.2mm のボクセル）: 鼓膜・耳小骨・前庭窓・蝸牛窓を包む凸包を CAV_PAD だけ広げ、鼓膜より内側・側頭骨の中・
#   迷路の空所から CAV_WALL 以上離れた所（前庭窓と蝸牛窓のまわりは除く）。耳小骨の所はくりぬく。
# - 外耳道: 鼓膜の外側から、側頭骨と外耳（耳介）の外の空いた所を、外へ x の断面ごとにたどる（前の断面の中心から MEATUS_R 以内）。
#   断面の空いた所が円のほとんどになったら（耳介の外に出たら）終わり。
# - 耳管の骨部: Z-Anatomy の耳管（軟骨部だけ）の外側の端から鼓室の前の壁まで、迷路から離れた道（側頭骨の中の最短の道）に管を作る。
import json
import os
import sys

import numpy as np
import scipy.sparse as sp
from scipy import ndimage as ndi
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import Delaunay, cKDTree

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "nasal"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kidney"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "heart"))
from nasalseg import surface_nets, taubin  # noqa: E402
import kidney  # noqa: E402
import heart  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "ear")
H_IN = 0.1  # 迷路のボクセル（mm）
H_MID = 0.2  # 鼓室・外耳道のボクセル（mm）
CORE = 1.0  # 前庭の芯（壁からこの距離より深い所、mm）
GROW = 2.0  # 前庭の芯から形の中を広げる距離（その外に残る管が半規管、mm）
CRUS_D = 0.9  # 総脚（前・後半規管の2つの平面からともにこの距離以内、mm）
DUCT = 0.36  # 半規管の膜の太さ（骨の管の半径に対する比）
AMP = 0.62  # 膜膨大部の太さ（骨の膨大部の半径に対する比）
AMP_LEN = 1.6  # 膨大部の長さ（管の端から、mm）
CREST_T = 0.22  # 膨大部稜の厚さの半分（管の向き、mm）
CREST_H = 0.6  # 膨大部稜の高さ（膜膨大部の半径に対する比）
WALL = 0.12  # 膜迷路と骨の壁のすき間（mm）
UTRICLE = (1.9, 0.95, 0.8)  # 卵形嚢の半径（長い向き・ほかの2つ、mm）
SACCULE = 0.8  # 球形嚢の半径（mm）
LAMINA = -0.1  # 骨ラセン板・基底板の高さ（管の中心から軸の向き、管の半径に対する比）
REISSNER = (-0.15, 0.85)  # 前庭膜の線（内のはしの外向きの位置、傾き。半径に対する比）
HELICO = 1.5  # 蝸牛孔（頂のこの長さには蝸牛管を作らない、mm）
DUCT_BASE = 0.5  # 蝸牛管の始まり（根もとからの道のり、mm）
OW_T = 0.3  # 前庭窓の板の厚さ（mm）
RW_R = 0.75  # 蝸牛窓の半径（mm）
RW_T = 0.3  # 蝸牛窓の板の厚さ（mm）
CAV_PAD = 1.0  # 鼓室（耳小骨などの凸包を広げる距離、mm）
CAV_WALL = 0.4  # 鼓室と迷路の空所の間の骨の厚さ（mm）
MEATUS_R = 5.5  # 外耳道を断面ごとにたどる広さ（前の中心からの半径、mm）
MEATUS_R0 = 3.5  # 外耳道の壁の無い所をつなぐ円の半径の始めの値（mm。壁のある所の太さで更新する）
MEATUS_MAX = 30.0  # 外耳道をたどる長さの上限（鼓膜から、mm）
TUBE_R = (1.4, 0.9)  # 耳管の骨部の半径（鼓室の口、峡部、mm）
TUBE_CLEAR = 1.0  # 耳管の骨部を迷路から離す距離（管の半径に足す、mm）
SNAP = 0.15  # 迷路の外の面を元の Z-Anatomy の面へ吸い付ける距離（mm）
CHECK = "--check" in sys.argv

# ラベル
VEST, UTR, SAC, ANT, POST, LAT, CRUS, ANT_D, POST_D, LAT_D, CRUS_D_L, ANT_C, POST_C, LAT_C, SV, CD, ST, OW, RW = range(1, 20)
# 部品: (ラベル, ID の末尾, 名前, 元の面へ吸い付けるか)。名前は Z-Anatomy の部品と同じく左右を前に付ける
PARTS = [
    (VEST, "vestibule", "vestibule proper", True),
    (UTR, "utricle", "utricle", False),
    (SAC, "saccule", "saccule", False),
    (ANT, "anterior_canal", "bony anterior semicircular canal", True),
    (POST, "posterior_canal", "bony posterior semicircular canal", True),
    (LAT, "lateral_canal", "bony lateral semicircular canal", True),
    (CRUS, "common_crus", "common bony limb", True),
    (ANT_D, "anterior_duct", "anterior semicircular duct", False),
    (POST_D, "posterior_duct", "posterior semicircular duct", False),
    (LAT_D, "lateral_duct", "lateral semicircular duct", False),
    (CRUS_D_L, "common_membranous_limb", "common membranous limb", False),
    (ANT_C, "anterior_crest", "ampullary crest of anterior semicircular duct", False),
    (POST_C, "posterior_crest", "ampullary crest of posterior semicircular duct", False),
    (LAT_C, "lateral_crest", "ampullary crest of lateral semicircular duct", False),
    (SV, "scala_vestibuli", "scala vestibuli", True),
    (CD, "cochlear_duct", "cochlear duct", False),
    (ST, "scala_tympani", "scala tympani", True),
    (OW, "oval_window", "oval window", False),
    (RW, "round_window", "round window", False),
]
COLORS = {VEST: (190, 150, 210), UTR: (60, 120, 220), SAC: (40, 170, 200), ANT: (230, 90, 90), POST: (240, 190, 60), LAT: (90, 190, 90),
          CRUS: (240, 140, 60), ANT_D: (130, 20, 20), POST_D: (140, 100, 0), LAT_D: (20, 100, 20), CRUS_D_L: (150, 70, 0),
          ANT_C: (255, 255, 255), POST_C: (255, 255, 255), LAT_C: (255, 255, 255), SV: (160, 120, 220), CD: (60, 200, 120), ST: (120, 160, 240),
          OW: (255, 60, 200), RW: (255, 60, 200)}


def load(m, mirror=False):
    P, F = kidney.load(m)
    if mirror:
        P = P * [-1, 1, 1]
        F = F[:, ::-1]
    return P, F


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


class Grid:
    def __init__(self, lo, hi, h):
        self.h = h
        self.lo = np.asarray(lo, dtype=np.float64)
        self.shape = tuple(int(v) for v in np.ceil((np.asarray(hi) - self.lo) / h).astype(int) + 1)

    def voxelize(self, P, F):
        return voxelize(P, F, self.lo, self.shape, self.h)

    def points(self, mask):
        idx = np.argwhere(mask)
        return self.lo + (idx + 0.5) * self.h, idx

    def all_points(self):
        idx = np.indices(self.shape).reshape(3, -1).T
        return self.lo + (idx + 0.5) * self.h

    def edt(self, mask):
        """mask の中の、外までの距離（mm）"""
        return (ndi.distance_transform_edt(mask) * self.h).astype(np.float32)


def voxelize(P, F, origin, shape, h):
    """閉じた形の中のボクセル（kidney.voxelize と同じ。格子の外で交わる分も数えるので、格子より大きな形の一部も正しく取れる）"""
    votes = np.zeros(shape, dtype=np.int8)
    G = (P - origin) / h - 0.5
    tri = G[F]
    for axis in range(3):
        u, v = [a for a in range(3) if a != axis]
        cross = np.zeros(tuple(s + 1 if k == axis else s for k, s in enumerate(shape)), dtype=np.int16)
        lo_all = np.floor(tri.min(1)).astype(int)
        hi_all = np.ceil(tri.max(1)).astype(int)
        keep = (hi_all[:, u] >= 0) & (lo_all[:, u] < shape[u]) & (hi_all[:, v] >= 0) & (lo_all[:, v] < shape[v]) & (lo_all[:, axis] < shape[axis])
        for t in np.nonzero(keep)[0]:
            a, b, c = tri[t]
            lo, hi = lo_all[t], hi_all[t]
            us = np.arange(max(lo[u], 0), min(hi[u], shape[u] - 1) + 1)
            vs = np.arange(max(lo[v], 0), min(hi[v], shape[v] - 1) + 1)
            if not len(us) or not len(vs):
                continue
            UU, VV = np.meshgrid(us, vs, indexing="ij")
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
            zi = np.clip(np.ceil(z[inside]).astype(int), 0, shape[axis])  # この添字から先が反対側（格子より手前で交わるものは 0）
            idx = [None] * 3
            idx[u] = UU[inside]
            idx[v] = VV[inside]
            idx[axis] = zi
            np.add.at(cross, tuple(idx), 1)
        sl = [slice(None)] * 3
        sl[axis] = slice(0, shape[axis])
        votes += (np.cumsum(cross, axis=axis)[tuple(sl)] % 2).astype(np.int8)
    return votes >= 2


def geodesic_labels(mask, labels, h):
    """mask の中の 0 のボクセルに、形の中の道のりでいちばん近いラベルを付ける"""
    kidney.H = h
    G, coords = kidney.voxel_graph(mask)
    lab = labels[tuple(coords.T)]
    src = np.nonzero(lab > 0)[0]
    _, _, sources = dijkstra(G, indices=src, min_only=True, return_predecessors=True)
    out = labels.copy()
    ok = sources >= 0
    out[tuple(coords[ok].T)] = lab[sources[ok]]
    return out


def geodesic_from(mask, start, h):
    """mask の中の、start（mask と同じ形の真偽）からの道のり（mm。届かない所は inf）"""
    kidney.H = h
    G, coords = kidney.voxel_graph(mask)
    src = np.nonzero(start[tuple(coords.T)])[0]
    d = dijkstra(G, indices=src, min_only=True)
    out = np.full(mask.shape, np.inf, dtype=np.float32)
    out[tuple(coords.T)] = d
    return out


def fit_plane(q):
    c = q.mean(0)
    _, s, vt = np.linalg.svd(q - c, full_matrices=False)
    return c, vt[2], vt[0], vt[1], s / np.sqrt(len(q))


def fit_circle(q):
    """点の当てはまる円: (中心, 法線, 半径, 面の中の2つの向き)"""
    c, n, e1, e2, _ = fit_plane(q)
    x, y = (q - c) @ e1, (q - c) @ e2
    A = np.c_[2 * x, 2 * y, np.ones_like(x)]
    (cx, cy, k), *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    return c + cx * e1 + cy * e2, n, np.sqrt(k + cx * cx + cy * cy), e1, e2


def smooth_path(P, k=2):
    P = np.asarray(P, dtype=np.float64)
    out = P.copy()
    for i in range(len(P)):
        lo, hi = max(0, i - k), min(len(P), i + k + 1)
        out[i] = P[lo:hi].mean(0)
    out[0], out[-1] = P[0], P[-1]
    return out


def resample(P, step):
    P = np.asarray(P, dtype=np.float64)
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    s = np.linspace(0, L[-1], max(2, int(np.ceil(L[-1] / step)) + 1))
    return np.stack([np.interp(s, L, P[:, k]) for k in range(3)], 1), s


# ---------------------------------------------------------------- 迷路
def canals(grid, V, E):
    """前庭の形 V（前庭と半規管）の中を、前庭・3つの半規管・総脚に分ける。返り値 (ラベル, 管ごとの情報)"""
    h = grid.h
    core = E > CORE
    V0 = core.copy()
    for _ in range(int(round(GROW / h))):
        V0 = ndi.binary_dilation(V0) & V
    R = V & ~V0
    lab, k = ndi.label(R, structure=np.ones((3, 3, 3)))
    sizes = np.bincount(lab.ravel())
    order = [c for c in np.argsort(sizes[1:])[::-1] + 1 if sizes[c] > 0.15 * sizes[np.argmax(sizes[1:]) + 1]]
    labels = np.zeros(V.shape, dtype=np.int16)
    labels[core] = VEST
    labels[R & ~np.isin(lab, order)] = VEST  # 小さなかけら（前庭窓のまわりのふくらみなど）は前庭
    comps = []
    for c in order:
        q, idx = grid.points(lab == c)
        _, n, _, _, s = fit_plane(q)
        comps.append({"q": q, "idx": idx, "n": n, "flat": s[2] / s[1]})
    if len(comps) == 3:
        # 3つの管が離れている: 法線がいちばん上下を向くものが外側、残りの上が前
        comps.sort(key=lambda c: -abs(c["n"][1]))
        lateral, rest = comps[0], sorted(comps[1:], key=lambda c: -c["q"][:, 1].mean())
        labels[tuple(lateral["idx"].T)] = LAT
        labels[tuple(rest[0]["idx"].T)] = ANT
        labels[tuple(rest[1]["idx"].T)] = POST
    elif len(comps) == 2:
        comps.sort(key=lambda c: -c["flat"])  # 前・後半規管のかたまりは平らでない
        pair, lateral = comps
        labels[tuple(lateral["idx"].T)] = LAT
        q, idx = pair["q"], pair["idx"]
        a = (q[:, 1] > np.percentile(q[:, 1], 60)).astype(int)  # 1＝前（上）、0＝後ろ
        N, D = np.zeros((2, 3)), np.zeros(2)
        for _ in range(60):
            for j in range(2):
                c, n, _, _, _ = fit_plane(q[a == j])
                N[j], D[j] = n, n @ c
            d = np.abs(q @ N.T - D)
            a2 = d.argmin(1)
            if (a2 == a).all():
                break
            a = a2
        lab_pair = np.where(a == 1, ANT, POST)
        near = (d[:, 0] < CRUS_D) & (d[:, 1] < CRUS_D)
        m = np.zeros(V.shape, dtype=bool)
        m[tuple(idx[near].T)] = True
        cl, ck = ndi.label(m, structure=np.ones((3, 3, 3)))
        if ck:
            best = max(range(1, ck + 1), key=lambda j: (grid.points(cl == j)[0][:, 1].mean() if (cl == j).sum() > 50 else -np.inf))
            is_crus = cl[tuple(idx.T)] == best
            lab_pair = np.where(is_crus, CRUS, lab_pair)
        labels[tuple(idx.T)] = lab_pair
        # 平面の交わる線は総脚のほか膨大部の近くも通るので、前・後・総脚はそれぞれいちばん大きなかたまりだけ残す（かけらは道のりで付け直す）
        for key in (ANT, POST, CRUS):
            cl, ck = ndi.label(labels == key, structure=np.ones((3, 3, 3)))
            if ck > 1:
                big = np.argmax(np.bincount(cl.ravel())[1:]) + 1
                labels[(cl > 0) & (cl != big)] = 0
        print(f"  前・後半規管の面の角度 {np.degrees(np.arccos(abs(N[0] @ N[1]))):.1f}°、総脚 {(lab_pair == CRUS).sum()} ボクセル")
    else:
        raise SystemExit(f"半規管のかたまりが {len(comps)} 個（2 か 3 のはず）")
    labels = geodesic_labels(V, labels, h)
    info = {}
    for key in (ANT, POST, LAT):
        q, _ = grid.points((labels == key) & R)  # 円は管のまわりだけで当てはめる
        center, n, r, e1, e2 = fit_circle(q)
        # 前・後半規管の弧は総脚を通って前庭へ入る（総脚をはさんで弧が飛ばないように、総脚も弧に入れる）
        qa, idx = grid.points((labels == key) | ((labels == CRUS) & (key != LAT)))
        rel = qa - center
        th = np.arctan2(rel @ e2, rel @ e1)
        # 管の切れ目（前庭の側）: 角度のいちばん大きな空き
        bins = np.zeros(72, dtype=int)
        np.add.at(bins, ((th + np.pi) / (2 * np.pi) * 72).astype(int) % 72, 1)
        empty = bins < 3
        best, start, run = (0, 0), None, 0
        for j in range(144):
            if empty[j % 72]:
                if run == 0:
                    start = j
                run += 1
                if run > best[0]:
                    best = (run, start)
            else:
                run = 0
        gap_start = best[1] % 72
        t = ((th + np.pi) / (2 * np.pi) * 72 - (gap_start + best[0])) % 72  # 切れ目の終わりから 0
        path, radius = [], []
        for j in np.arange(0, 72 - best[0], 1.0):
            m = (t >= j) & (t < j + 1)
            if m.sum() < 5:
                continue
            path.append(qa[m].mean(0))
            radius.append(E[tuple(idx[m].T)].max())
        path, radius = smooth_path(np.array(path)), np.convolve(np.pad(radius, 1, mode="edge"), np.ones(3) / 3, "valid")
        L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
        k0 = L <= AMP_LEN
        k1 = L >= L[-1] - AMP_LEN
        if radius[k0].max() < radius[k1].max():  # 膨大部を始まりにそろえる
            path, radius = path[::-1], radius[::-1]
            L = L[-1] - L[::-1]
        info[key] = {"center": center, "normal": n, "r": r, "path": path, "radius": radius, "L": L}
        print(f"  半規管 {key}: 円の半径 {r:.2f}mm、管の長さ {L[-1]:.1f}mm、管の半径 {radius.min():.2f}〜{radius.max():.2f}mm")
    q, _ = grid.points(labels == CRUS)
    if len(q):
        c, n, e1, _, _ = fit_plane(q)
        x = (q - c) @ e1
        top, bottom = c + e1 * x.max(), c + e1 * x.min()
        if top[1] < bottom[1]:
            top, bottom = bottom, top
        info[CRUS] = {"top": top, "bottom": bottom, "radius": float(np.median(E[labels == CRUS]))}
    return labels, info


def cochlea(grid, C, V, E):
    """蝸牛の形 C の中を前庭階・蝸牛管・鼓室階に分ける。返り値 (ラベル, 情報)"""
    h = grid.h
    base = ndi.binary_dilation(V, iterations=2) & C
    s = geodesic_from(C, base, h)
    s[~np.isfinite(s)] = 0
    q, idx = grid.points(C)
    sv = s[tuple(idx.T)]
    smax = sv.max()
    path, radius = [], []
    for b in np.arange(0, smax, 0.25):
        m = (sv >= b) & (sv < b + 0.25)
        if m.sum() < 5:
            continue
        path.append(q[m].mean(0))
        radius.append(E[tuple(idx[m].T)].max())
    path = smooth_path(np.array(path), 2)
    radius = np.array(radius)
    c0, axis, _, _, _ = fit_plane(path)
    half = len(path) // 2
    if (path[-1] - path[:half].mean(0)) @ axis < 0:
        axis = -axis
    center, _, _, e1, e2 = fit_circle(path[: max(4, int(len(path) * 0.7))])
    fine, sfine = resample(path, 0.05)
    rfine = np.interp(sfine, np.r_[0, np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))], radius)
    T = unit(np.gradient(fine, axis=0))
    tree = cKDTree(fine)
    _, j = tree.query(q)
    rel = q - fine[j]
    t = T[j]
    ax = unit(axis[None, :] - np.sum(t * axis, 1)[:, None] * t)
    # 外向き＝らせんの曲がりの外（中心線をならして曲率の向きの反対）。曲がりの弱い所は円の中心から外へ
    sm = ndi.gaussian_filter1d(fine, 12, axis=0, mode="nearest")
    Ts = unit(np.gradient(sm, axis=0))
    K = np.gradient(Ts, axis=0) / 0.05
    K -= np.sum(K * axis, 1)[:, None] * axis
    away = unit(fine - center)
    curv = np.linalg.norm(K, axis=1)
    outward = np.where((curv > 0.08)[:, None], -unit(K), away)
    out = outward[j]
    out = unit(out - np.sum(out * t, 1)[:, None] * t - np.sum(out * ax, 1)[:, None] * ax)
    R = np.maximum(rfine[j], 0.3)
    zeta = np.sum(rel * ax, 1) / R
    rho = np.sum(rel * out, 1) / R
    upper = zeta >= LAMINA
    duct = upper & (zeta <= LAMINA + REISSNER[1] * (rho - REISSNER[0])) & (rho > REISSNER[0])
    duct &= (sv >= DUCT_BASE) & (sv <= smax - HELICO)
    lab = np.where(upper, SV, ST)
    lab = np.where(duct, CD, lab)
    labels = np.zeros(C.shape, dtype=np.int16)
    labels[tuple(idx.T)] = lab
    print(f"  蝸牛: 中心線 {sfine[-1]:.1f}mm、管の半径 {radius.min():.2f}〜{radius.max():.2f}mm、前庭階 {(lab == SV).sum()} 蝸牛管 {(lab == CD).sum()} 鼓室階 {(lab == ST).sum()} ボクセル")
    return labels, {"path": fine, "s": sfine, "axis": axis, "center": center, "geo": s}


def paint_tube(grid, mask_allowed, path, radius):
    """道（点の並び、mm）のまわり radius（点ごと）の中のボクセル（mask_allowed の中だけ）"""
    path, s = resample(path, grid.h * 0.5)
    rad = np.interp(s, np.linspace(0, s[-1], len(radius)), radius)
    lo = np.floor((path.min(0) - rad.max() - grid.h - grid.lo) / grid.h).astype(int)
    hi = np.ceil((path.max(0) + rad.max() + grid.h - grid.lo) / grid.h).astype(int)
    lo, hi = np.maximum(lo, 0), np.minimum(hi, np.array(grid.shape) - 1)
    sub = np.indices(hi - lo + 1).reshape(3, -1).T + lo
    p = grid.lo + (sub + 0.5) * grid.h
    d, i = cKDTree(path).query(p)
    ok = d <= rad[i]
    out = np.zeros(grid.shape, dtype=bool)
    out[tuple(sub[ok].T)] = True
    return out & mask_allowed


def membranous(grid, labels, info, lumen, coch_info, V, C):
    """膜迷路（半規管の膜・膜膨大部・膨大部稜・卵形嚢・球形嚢）をラベルに描く"""
    h = grid.h
    Ewall = grid.edt(lumen)
    inner = Ewall >= WALL
    vest = labels == VEST
    # 卵形嚢と球形嚢の位置
    core_c = grid.points(vest & (Ewall > CORE))[0].mean(0)
    ends = []
    for key in (ANT, POST, LAT):
        ends.append(info[key]["path"][0])  # 膨大部の端
    ends.append(info[LAT]["path"][-1])  # 外側半規管の膨大部でない端
    ends.append(info[CRUS]["bottom"] if CRUS in info else (info[ANT]["path"][-1] + info[POST]["path"][-1]) / 2)
    ends = np.array(ends)
    u0 = core_c + 0.35 * (ends.mean(0) - core_c)
    long_axis = unit(ends[3:].mean(0) - ends[:3].mean(0))  # 膨大部（前）から総脚（後ろ）へ
    cochlea_mouth = grid.points(ndi.binary_dilation(C, iterations=2) & vest)[0].mean(0)
    s0 = core_c + 0.5 * (cochlea_mouth - core_c)
    pts, idx = grid.points(vest & inner)
    rel = pts - u0
    a = rel @ long_axis
    b = rel - a[:, None] * long_axis
    ell = (a / UTRICLE[0]) ** 2 + np.sum(b * b, 1) / (UTRICLE[1] * UTRICLE[2])
    utr = ell <= 1
    sac = (np.linalg.norm(pts - s0, axis=1) <= SACCULE) & ~utr
    m_utr = np.zeros(grid.shape, dtype=bool)
    m_utr[tuple(idx[utr].T)] = True
    m_sac = np.zeros(grid.shape, dtype=bool)
    m_sac[tuple(idx[sac].T)] = True
    m_sac &= ~ndi.binary_dilation(m_utr, iterations=2)
    # 球形嚢は1つのかたまりに
    sl, sk = ndi.label(m_sac)
    if sk > 1:
        m_sac = sl == (np.argmax(np.bincount(sl.ravel())[1:]) + 1)
    labels[m_utr] = UTR
    labels[m_sac] = SAC
    print(f"  卵形嚢 {m_utr.sum()} 球形嚢 {m_sac.sum()} ボクセル")
    # 半規管の膜
    duct_of = {ANT: ANT_D, POST: POST_D, LAT: LAT_D}
    crest_of = {ANT: ANT_C, POST: POST_C, LAT: LAT_C}
    for key in (ANT, POST, LAT):
        c = info[key]
        path, R, L = c["path"], c["radius"], c["L"]
        outward = unit(path - c["center"])
        outward = unit(outward - np.sum(outward * c["normal"], 1)[:, None] * c["normal"])
        jp = int(np.argmax(R * (L <= AMP_LEN)))  # 膨大部のいちばん太い所
        Rm = np.median(R)
        # 膨大部の重み: 管の端から膨大部の太い所までは 1、その先 AMP_LEN の半分で 0 へ
        w = np.clip(1 - (L - L[jp]) / (AMP_LEN * 0.5), 0, 1) ** 0.7
        r = DUCT * Rm * (1 - w) + AMP * R[jp] * w
        shift = np.maximum(R - r - WALL - 0.03, 0) * (1 - w)
        center = path + outward * shift[:, None]
        # 両端を卵形嚢までのばす（前・後半規管の膨大部でない端は総脚の下の端）
        to_u = lambda p: [p + (u0 - p) * f for f in np.linspace(0, 1, 8)[1:]]
        head, tail = to_u(center[0])[::-1], to_u(center[-1])
        full = np.vstack([head, center, tail])
        rfull = np.r_[np.full(len(head), r[0]), r, np.full(len(tail), r[-1])]
        allowed = np.isin(labels, (key, VEST, CRUS, duct_of[key], CRUS_D_L)) & inner
        m = paint_tube(grid, allowed, full, rfull)
        # 膜の管はつながった1本に（細い所で切れたかけらは塗らない）
        cl, ck = ndi.label(m, structure=np.ones((3, 3, 3)))
        if ck > 1:
            m = cl == (np.argmax(np.bincount(cl.ravel())[1:]) + 1)
        labels[m & np.isin(labels, (key, VEST))] = duct_of[key]
        labels[m & np.isin(labels, (CRUS, CRUS_D_L))] = CRUS_D_L
        # 膨大部稜: 膨大部の太い所で、膜膨大部の内側（円の中心の側）の壁から横向きに高まる
        T = unit(path[min(jp + 1, len(path) - 1)] - path[max(jp - 1, 0)])
        p0, inward, rj = center[jp], -outward[jp], r[jp]
        pts, idx = grid.points(labels == duct_of[key])
        rel = pts - p0
        crest = (np.abs(rel @ T) <= CREST_T) & (rel @ inward >= rj * (1 - CREST_H) - 0.05) & (np.linalg.norm(rel, axis=1) <= rj + 0.1)
        labels[tuple(idx[crest].T)] = crest_of[key]
        print(f"  半規管の膜 {key}: 膜の半径 {r.min():.2f}〜{r.max():.2f}mm、膨大部稜 {crest.sum()} ボクセル")
    # 前・後半規管の膜のうち総脚より先（卵形嚢へ入る所）は、本体から離れているので膜の総脚に入れる
    for key in (ANT_D, POST_D):
        cl, ck = ndi.label(labels == key, structure=np.ones((3, 3, 3)))
        if ck > 1:
            big = np.argmax(np.bincount(cl.ravel())[1:]) + 1
            labels[(cl > 0) & (cl != big)] = CRUS_D_L
    # 球形嚢と蝸牛管をつなぐ結合管（細い管。蝸牛管に入れる）
    cd_pts, _ = grid.points(labels == CD)
    if len(cd_pts) and m_sac.any():
        sac_c = grid.points(m_sac)[0].mean(0)
        start = cd_pts[np.argmin(np.linalg.norm(cd_pts - sac_c, axis=1))]
        m = paint_tube(grid, np.isin(labels, (VEST, SV, ST)) & inner, np.array([sac_c, start]), np.array([0.18, 0.18]))
        labels[m] = CD
    return labels, {"utricle": u0, "saccule": s0}


def inside_poly(points2, poly):
    """2次元の多角形の中か（偶奇）"""
    x, y = points2[:, 0], points2[:, 1]
    inside = np.zeros(len(points2), dtype=bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > y) != (y2 > y)
        xi = x1 + (y - y1) * (x2 - x1) / np.where(y2 - y1 == 0, 1e-12, y2 - y1)
        inside ^= cond & (x < xi)
    return inside


def make_windows(grid, labels, ow_loop, coch_info, target, C):
    c = ow_loop.mean(0)
    _, n, e1, e2, _ = fit_plane(ow_loop)
    if (target - c) @ n > 0:
        n = -n  # n は前庭の中へ向ける（鼓室の反対）
    poly = np.c_[(ow_loop - c) @ e1, (ow_loop - c) @ e2] * 1.05
    pts, idx = grid.points(np.isin(labels, (VEST, UTR, SAC, SV, ST)))
    rel = pts - c
    depth = rel @ n
    ow = (depth >= -0.05) & (depth <= OW_T) & inside_poly(np.c_[rel @ e1, rel @ e2], poly)
    labels[tuple(idx[ow].T)] = OW
    print(f"  前庭窓 {ow.sum()} ボクセル（穴の半径 {np.linalg.norm(ow_loop - c, axis=1).mean():.2f}mm）")
    # 蝸牛窓: 鼓室階の、蝸牛の形の面に近いボクセルのうち、根もとの近くで鼓室（target）にいちばん近い所
    geo = coch_info["geo"]
    st = labels == ST
    shell = st & ~ndi.binary_erosion(C, iterations=int(np.ceil(RW_T / grid.h)))
    pts, idx = grid.points(shell & (geo >= 0.6) & (geo <= 3.5))
    if not len(pts):
        raise SystemExit("蝸牛窓の場所が見つかりません")
    p = pts[np.argmin(np.linalg.norm(pts - target, axis=1))]
    pts, idx = grid.points(shell)
    rw = np.linalg.norm(pts - p, axis=1) <= RW_R
    labels[tuple(idx[rw].T)] = RW
    print(f"  蝸牛窓 {rw.sum()} ボクセル、前庭窓の中心から {np.linalg.norm(p - c):.1f}mm")
    return labels, {"oval": c, "oval_normal": n, "round": p}


def labyrinth(d):
    Pc, Fc = d["cochlea"]
    Pv, Fv = d["vestibule"]
    lo = np.minimum(Pc.min(0), Pv.min(0)) - 1.0
    hi = np.maximum(Pc.max(0), Pv.max(0)) + 1.0
    grid = Grid(lo, hi, H_IN)
    C = grid.voxelize(Pc, Fc)
    V = grid.voxelize(Pv, Fv) & ~C
    lumen = C | V
    print(f"  迷路の格子 {grid.shape}、蝸牛 {C.sum() * H_IN ** 3:.0f}mm³、前庭と半規管 {V.sum() * H_IN ** 3:.0f}mm³")
    labels, info = canals(grid, V, grid.edt(V))
    clab, cinfo = cochlea(grid, C, V, grid.edt(C))
    labels[C] = clab[C]
    # 前庭窓の穴: 前庭の開いた輪のうち、蝸牛との境でないもの
    loops = kidney.boundary_loops(Fv)
    shared = set(map(tuple, np.round(Pc, 4)))
    ow_loop = None
    for loop in loops:
        if not any(tuple(np.round(Pv[i], 4)) in shared for i in loop):
            ow_loop = Pv[loop]
    if ow_loop is None:
        raise SystemExit("前庭窓の穴（前庭の開いた輪）がありません")
    return grid, labels, info, cinfo, lumen, C, V, ow_loop


# ---------------------------------------------------------------- 鼓室・外耳道・耳管
def middle(d, lab_grid, labels, win, lumen_lab):
    TM = d["tympanic membrane"][0]
    oss = [d[k] for k in ("malleus", "incus", "stapes")]
    Pb, Fb = d["temporal bone"]
    Pe, Fe = d["external ear"]
    tube_P = d["auditory tube"][0]
    lo = np.minimum(TM.min(0), lab_grid.lo) - [MEATUS_MAX, 8, 8]
    hi = np.maximum(TM.max(0), lab_grid.lo + np.array(lab_grid.shape) * lab_grid.h) + [2, 6, 6]
    hi[0] = max(hi[0], tube_P[:, 0].min() + 3)
    grid = Grid(lo, hi, H_MID)
    print(f"  中耳の格子 {grid.shape}")
    bone = grid.voxelize(Pb, Fb)
    ear = grid.voxelize(Pe, Fe)
    ossm = np.zeros(grid.shape, dtype=bool)
    for P, F in oss:
        ossm |= grid.voxelize(P, F)
    ossm = ndi.binary_dilation(ossm)
    # 迷路の空所（0.1mm の格子から写す）
    pts = grid.all_points()
    li = np.floor((pts - lab_grid.lo) / lab_grid.h).astype(int)
    ok = ((li >= 0) & (li < lab_grid.shape)).all(1)
    lum = np.zeros(len(pts), dtype=bool)
    lum[ok] = lumen_lab[tuple(li[ok].T)]
    lum = lum.reshape(grid.shape)
    dist_lum = (ndi.distance_transform_edt(~lum) * grid.h).astype(np.float32)
    # 鼓膜の面: 鼓膜の点の法線（外側＝ -x の向き）で、鼓膜の近くの点がどちらの側かを決める
    tm_c = TM.mean(0)
    _, tm_n, _, _, _ = fit_plane(TM)
    if tm_n[0] > 0:
        tm_n = -tm_n  # tm_n は外へ
    tm_tree = cKDTree(TM)
    dd, ii = tm_tree.query(pts)
    side = (pts - TM[ii]) @ tm_n  # 正なら外側
    plane_side = (pts - tm_c) @ tm_n
    lateral = np.where(dd < 3.0, side > 0.05, plane_side > 0.05).reshape(grid.shape)
    medial = np.where(dd < 3.0, side < -0.05, plane_side < -0.05).reshape(grid.shape)
    # 鼓室
    hull_pts = np.vstack([TM] + [P for P, _ in oss] + [win["oval"][None], win["round"][None]])
    hull = Delaunay(hull_pts)
    inhull = (hull.find_simplex(pts) >= 0).reshape(grid.shape)
    cav = ndi.binary_dilation(inhull, iterations=int(round(CAV_PAD / grid.h)))
    near_win = (np.linalg.norm(pts - win["oval"], axis=1) < 1.2) | (np.linalg.norm(pts - win["round"], axis=1) < 1.0)
    cav &= medial & bone & ((dist_lum >= CAV_WALL) | near_win.reshape(grid.shape)) & ~lum
    cav &= ~ossm
    cl, ck = ndi.label(cav)
    cav = cl == (np.argmax(np.bincount(cl.ravel())[1:]) + 1)
    print(f"  鼓室 {cav.sum() * grid.h ** 3:.0f}mm³")
    # 外耳道: 鼓膜の外から x の断面ごとに
    free = ~bone & ~ear & lateral & ~ossm
    meat = np.zeros(grid.shape, dtype=bool)
    center = tm_c[1:].copy()
    ys = grid.lo[1] + (np.arange(grid.shape[1]) + 0.5) * grid.h
    zs = grid.lo[2] + (np.arange(grid.shape[2]) + 0.5) * grid.h
    YY, ZZ = np.meshgrid(ys, zs, indexing="ij")
    ix0 = int((tm_c[0] + 2.5 - grid.lo[0]) / grid.h)
    r_est = MEATUS_R0
    track = []
    seen_ear = False
    for ix in range(min(ix0, grid.shape[0] - 1), -1, -1):
        x = grid.lo[0] + (ix + 0.5) * grid.h
        dy, dz = YY - center[0], ZZ - center[1]
        disk = dy ** 2 + dz ** 2 <= MEATUS_R ** 2
        rim = disk & (dy ** 2 + dz ** 2 > (MEATUS_R - 2 * grid.h) ** 2)
        if (ear[ix] & disk).any():
            seen_ear = True
        elif seen_ear or x < tm_c[0] - MEATUS_MAX:
            print(f"  外耳道: x={x:.1f} で耳介の外に出た（鼓膜から {tm_c[0] - x:.1f}mm）")
            break
        sl = free[ix] & disk
        if not sl.any():
            continue
        lab2, _ = ndi.label(sl)
        pts2 = np.argwhere(lab2 > 0)
        dc = (ys[pts2[:, 0]] - center[0]) ** 2 + (zs[pts2[:, 1]] - center[1]) ** 2
        comp = lab2 == lab2[tuple(pts2[np.argmin(dc)])]
        if (comp & rim).sum() > 0.25 * rim.sum():
            # 壁の無い所（骨と耳介の間のすき間など）: これまでの太さの円でつなぐ
            comp &= dy ** 2 + dz ** 2 <= r_est ** 2
        else:
            r_est = 0.8 * r_est + 0.2 * np.sqrt(comp.sum() * grid.h ** 2 / np.pi)
        if not comp.any():
            continue
        c_new = np.array([YY[comp].mean(), ZZ[comp].mean()])
        center = 0.7 * center + 0.3 * c_new
        track.append((ix, *c_new, np.sqrt(comp.sum() * grid.h ** 2 / np.pi)))
    # 断面ごとの中心と太さをならし、その円（少し広げて壁に沿わせる）のうち空いた所を外耳道にする（段のない管になるように）
    track = np.array(track)
    cy = ndi.gaussian_filter1d(track[:, 1], 6, mode="nearest")
    cz = ndi.gaussian_filter1d(track[:, 2], 6, mode="nearest")
    rr = ndi.gaussian_filter1d(track[:, 3], 6, mode="nearest") * 1.15
    for (ix, _, _, _), y0, z0, r0 in zip(track, cy, cz, rr):
        meat[int(ix)] = free[int(ix)] & ((YY - y0) ** 2 + (ZZ - z0) ** 2 <= r0 ** 2)
    meat = ndi.binary_opening(meat, iterations=1)
    ml, mk = ndi.label(meat)
    meat = ml == (np.argmax(np.bincount(ml.ravel())[1:]) + 1)
    print(f"  外耳道 {meat.sum() * grid.h ** 3:.0f}mm³")
    # 耳管の骨部: Z-Anatomy の耳管の外側の端から鼓室まで、迷路と鼓室の外を通る最短の道
    # 軟骨部の軸（主成分）と外側の端（軸の上でいちばん外の 1.5mm の点の重心）
    tm0, axis_in, _, _, _ = fit_plane(tube_P)
    axis_in = unit(np.linalg.svd(tube_P - tm0, full_matrices=False)[2][0])
    if axis_in[0] < 0:
        axis_in = -axis_in  # 内側（+x）へ
    tt0 = (tube_P - tm0) @ axis_in
    end_pts = tube_P[tt0 < tt0.min() + 1.5]
    tube_end = end_pts.mean(0)
    rel_end = end_pts - tube_end
    tube_r = np.linalg.norm(rel_end - np.outer(rel_end @ axis_in, axis_in), axis=1).max()
    allowed = (bone | cav) & (dist_lum >= TUBE_R[1] + TUBE_CLEAR * 0.5) & ~ossm
    allowed |= (np.linalg.norm(pts - tube_end, axis=1) < tube_r + 1).reshape(grid.shape)
    kidney.H = grid.h
    G, coords = kidney.voxel_graph(allowed)
    cpts = grid.lo + (coords + 0.5) * grid.h
    # 道は迷路から離れるほど通りやすく
    cost = 1 + 3.0 * np.clip((TUBE_R[0] + TUBE_CLEAR - dist_lum[tuple(coords.T)]) / TUBE_CLEAR, 0, 1)
    G = sp.diags(cost) @ G
    start = np.argmin(np.linalg.norm(cpts - tube_end, axis=1))
    in_cav = cav[tuple(coords.T)]
    dist, pred = dijkstra(G, indices=[start], return_predecessors=True)
    dist, pred = dist[0], pred[0]
    goal_c = np.nonzero(in_cav)[0]
    goal = goal_c[np.argmin(dist[goal_c])]
    chain = [goal]
    while chain[-1] != start and pred[chain[-1]] >= 0:
        chain.append(pred[chain[-1]])
    tube_path, _ = resample(cpts[chain], 0.4)  # 鼓室 → 耳管の端
    for _ in range(6):
        tube_path = smooth_path(tube_path, 4)
    # 終わりの 4mm は、軟骨部の向き（軸）に沿って入るように曲線で付けかえる
    k = np.nonzero(np.linalg.norm(tube_path - tube_end, axis=1) > 4.0)[0].max()
    p0, ctrl = tube_path[k], tube_end - axis_in * 2.5
    tt = np.linspace(0, 1, 12)[1:, None]
    tube_path = np.vstack([tube_path[: k + 1], (1 - tt) ** 2 * p0 + 2 * (1 - tt) * tt * ctrl + tt ** 2 * tube_end])
    Lp = np.r_[0, np.cumsum(np.linalg.norm(np.diff(tube_path, axis=0), axis=1))]
    f = Lp / Lp[-1]
    # 半径: 鼓室の口 TUBE_R[0] → 峡部（2/3）TUBE_R[1] → 軟骨部の端 tube_r
    rad = np.where(f < 0.67, TUBE_R[0] + (TUBE_R[1] - TUBE_R[0]) * f / 0.67, TUBE_R[1] + (tube_r * 0.9 - TUBE_R[1]) * (f - 0.67) / 0.33)
    # 軟骨部の中へ少し入れてつなげる
    tube_path = np.vstack([tube_path, tube_end + axis_in * 0.8])
    rad = np.r_[rad, rad[-1]]
    print(f"  耳管の骨部: 長さ {Lp[-1]:.1f}mm、半径 {rad.min():.2f}〜{rad.max():.2f}mm")
    return grid, {"cavity": cav, "meatus": meat, "bone": bone, "ear": ear}, (tube_path, rad)


# ---------------------------------------------------------------- 面
def mask_surface(grid, mask, outer=None, smooth=0.7, level=0.56, min_faces=40, snap=SNAP):
    if not mask.any():
        return None
    lo_i = np.maximum(np.argwhere(mask).min(0) - 4, 0)
    hi_i = np.minimum(np.argwhere(mask).max(0) + 5, np.array(grid.shape))
    sub = mask[tuple(slice(lo_i[k], hi_i[k]) for k in range(3))]
    origin = grid.lo + lo_i * grid.h
    f = ndi.gaussian_filter(np.pad(sub, 2).astype(np.float32), smooth)
    v, faces = surface_nets(f, level)
    if not len(faces):
        return None
    v = taubin(v, faces, iterations=10)
    mm = origin + (v - 2 + 0.5) * grid.h
    if outer is not None:
        mm, _ = kidney.snap(mm, *outer, reach=snap)
    n = len(mm)
    adj = sp.coo_matrix((np.ones(len(faces) * 3), (np.repeat(faces[:, 0], 3), faces.ravel())), shape=(n, n))
    k, comp = connected_components(adj, directed=False)
    size = np.bincount(comp[faces[:, 0]], minlength=k)
    faces = faces[size[comp[faces[:, 0]]] >= min_faces]
    if not len(faces):
        return None
    used = np.unique(faces)
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return mm[used], remap[faces]


def merge(*meshes):
    Ps, Fs, o = [], [], 0
    for P, F in meshes:
        Ps.append(P)
        Fs.append(F + o)
        o += len(P)
    return np.vstack(Ps), np.vstack(Fs)


# ---------------------------------------------------------------- 確かめる絵
def first_hit(L):
    nz = L > 0
    i = np.argmax(nz, axis=-1)
    v = np.take_along_axis(L, i[..., None], -1)[..., 0]
    v[~nz.any(-1)] = 0
    return v


def color_of(lab):
    img = np.full(lab.shape + (3,), 30, dtype=np.uint8)
    for k, c in COLORS.items():
        img[lab == k] = c
    return img


def check_images(side, grid, labels, mid=None):
    from PIL import Image

    def save(img, name, scale):
        im = Image.fromarray(img)
        im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(os.path.join(DIR, f"check-{side}-{name}.png"))

    # 外から見た形（外側＝左から右へ見る・上から・後ろから）。膜迷路は骨迷路を外したもの
    bony = np.isin(labels, (VEST, ANT, POST, LAT, CRUS, SV, ST, OW, RW))
    for name, lab in (("bony", np.where(bony, labels, 0)), ("membranous", np.where(bony, 0, labels))):
        views = [
            first_hit(np.moveaxis(lab, 0, -1))[::-1, :],  # 外側から（右の耳。前が右）
            first_hit(np.moveaxis(lab, 1, -1)[:, :, ::-1]).T[::-1, :],  # 上から（後ろが上、内側が右）
            first_hit(lab).T[::-1, ::-1],  # 後ろから
        ]
        hmax = max(v.shape[0] for v in views)
        row = np.concatenate([np.pad(color_of(v), ((0, hmax - v.shape[0]), (0, 6), (0, 0))) for v in views], 1)
        save(row, name, 3)
    # 断面: 蝸牛の軸を通る面など、x・y・z の真ん中あたり
    rows = []
    for axis in range(3):
        cuts = []
        for frac in (0.35, 0.5, 0.65):
            k = int(grid.shape[axis] * frac)
            sl = [slice(None)] * 3
            sl[axis] = k
            img = color_of(labels[tuple(sl)])
            cuts.append(np.pad(img.transpose(1, 0, 2)[::-1], ((0, 0), (0, 4), (0, 0))))
        hmax = max(c.shape[0] for c in cuts)
        rows.append(np.concatenate([np.pad(c, ((0, hmax - c.shape[0]), (0, 0), (0, 0))) for c in cuts], 1))
    wmax = max(r.shape[1] for r in rows)
    save(np.concatenate([np.pad(r, ((0, 4), (0, wmax - r.shape[1]), (0, 0))) for r in rows], 0), "sections", 2)
    if mid is not None:
        g, m = mid
        lab = np.zeros(g.shape, dtype=np.int16)
        lab[m["bone"]] = 1
        lab[m["ear"]] = 2
        lab[m["cavity"]] = 3
        lab[m["meatus"]] = 4
        pal = np.array([(250, 250, 250), (225, 215, 190), (235, 190, 170), (80, 160, 230), (240, 120, 80)], dtype=np.uint8)
        cuts = []
        for frac in (0.3, 0.45, 0.6, 0.75):
            k = int(g.shape[2] * frac)
            cuts.append(np.pad(pal[lab[:, :, k]].transpose(1, 0, 2)[::-1], ((0, 0), (0, 4), (0, 0))))
        save(np.concatenate(cuts, 1), "middle-z", 3)
        cuts = []
        for frac in (0.3, 0.45, 0.6):
            k = int(g.shape[1] * frac)
            cuts.append(np.pad(pal[lab[:, k, :]].transpose(1, 0, 2)[::-1], ((0, 0), (0, 4), (0, 0))))
        save(np.concatenate(cuts, 1), "middle-y", 3)


# ---------------------------------------------------------------- 全体
def build_side(side, data):
    mirror = side == "left"
    d = {k: load(m, mirror) for k, m in data[side].items()}
    d["external ear"] = load(data["both"]["external ear"], mirror)
    print(f"{side}:")
    grid, labels, info, cinfo, lumen, C, V, ow_loop = labyrinth(d)
    labels, mem = membranous(grid, labels, info, lumen, cinfo, V, C)
    target = d["tympanic membrane"][0].mean(0)
    labels, win = make_windows(grid, labels, ow_loop, cinfo, target, C)
    mgrid, mid, tube = middle(d, grid, labels, win, lumen)
    if CHECK:
        check_images(side, grid, labels, (mgrid, mid))
    outer_lab = merge(d["cochlea"], d["vestibule"])
    parts = []

    def add(slug, name, mesh):
        if mesh is None:
            raise SystemExit(f"{side} {name} の形ができません")
        P, F = mesh
        if mirror:
            P = P * [-1, 1, 1]
            F = F[:, ::-1]
        parts.append({"id": f"ZE_{slug}_{side[0]}", "name": f"{side} {name}", "positions": np.round(P / 1000.0, 6).ravel().tolist(), "indices": np.asarray(F).ravel().tolist()})
        print(f"  {name}: {len(P)} 点 {len(F)} 三角形")

    for lab, slug, name, snapped in PARTS:
        thin = lab in (ANT_C, POST_C, LAT_C, OW, RW)
        add(slug, name, mask_surface(grid, labels == lab, outer=outer_lab if snapped else None, smooth=0.6 if thin else 0.7,
                                    level=0.45 if thin else 0.56, min_faces=10 if thin else 40))
    bone_mesh = merge(d["temporal bone"], d["external ear"])
    add("meatus", "external acoustic meatus", mask_surface(mgrid, mid["meatus"], outer=bone_mesh, smooth=1.0, snap=0.3))
    add("cavity", "tympanic cavity", mask_surface(mgrid, mid["cavity"], smooth=0.9))
    path, rad = tube
    P, F = heart.tube(path, rad, sides=14)
    add("bony_tube", "bony part of auditory tube", (P * 1000.0, F))
    return parts


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    parts = []
    for side in ("right", "left"):
        parts += build_side(side, data)
    with open(os.path.join(DIR, "parts.json"), "w") as f:
        json.dump({"parts": parts}, f)
    print(os.path.join(DIR, "parts.json"), len(parts), "部品")


if __name__ == "__main__":
    main()
