# 呼吸の動き（肺と胸郭の変位の場）を作る。
# 元のデータ: 4DMRI moving meshes（Duetschler, Jenny, Weber, Lomax, Zhang. Zenodo 2022, doi:10.5281/zenodo.7052607, CC BY 4.0）。
# 自由呼吸の 4DMRI（2.15 Hz）から取った、左右の肺と胸郭の点の動き（MRI1 は 549 時点・47 呼吸）。
# scripts/fetch-sources.sh が data-raw/motions/4DMRI_moving_meshes-v1.0.0/ に置き、scripts/motions/export.mjs が
# アプリの肺・胸郭の点を data-raw/motions/app.json に書く。
# 使い方: python3 scripts/motions/breathing.py → public/motions/breathing.json
#
# 考え方:
# - MRI の向きは x＝本人の左・y＝後ろ・z＝上（mm）。アプリは x＝左・y＝上・z＝前（m）なので (x, z, -y) にする。
# - 呼吸の信号: 肺の点の動きの主成分の1つめ（動きの 95% を占める。値が大きいほど吸っている）。
#   呼気の終わり（信号の谷）から次の谷までを1呼吸として、位相（0〜1）の 24 区間ごとに点の変位（呼気の終わりから）を平均する。
# - 平均した 24 位相の変位を主成分に分け、2つの形（場）と、位相ごとの重みにする（99% 以上を表せる）。
# - 場は胸の箱の格子（間隔 GRID m）に置く。MRI の肺の箱をアプリの肺の箱へ軸ごとに伸び縮みさせて重ね（変位も同じ倍率）、
#   格子の点の値は近くの MRI の点のガウスの重みつき平均。点の無い所は、まわりから広げる（ラプラス方程式。箱の外の縁は 0）。
# - 肺の場（肺の点から）と胸郭の場（胸郭の点から）を分ける: 肺は胸壁の内側をすべるので、1つにまとめると肋骨が肺底と一緒に下がってしまう。
# - 肺の容積: MRI の肺の面（lungs_*_surface.vtk の三角形）から位相ごとに求め、1回換気量の目安にする（被験者の実測）。
import glob
import json
import os

import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "data-raw", "motions", "4DMRI_moving_meshes-v1.0.0", "MRI1", "MovingMRmesh")
PHASES = 24
GRID = 0.02  # 格子の間隔（m）
RADIUS = 0.018  # 格子の点の値に使う MRI の点の範囲（m）
MARGIN = 0.04  # 胸の箱のまわりの余白（m）


def read_vtk(path):
    lines = open(path).read().split("\n")
    i = next(k for k, line in enumerate(lines) if line.startswith("POINTS"))
    n = int(lines[i].split()[1])
    values = []
    k = i + 1
    while len(values) < n * 3:
        values += lines[k].split()
        k += 1
    points = np.array(values[: n * 3], float).reshape(n, 3)
    polys = []
    for j, line in enumerate(lines):
        if line.startswith("POLYGONS"):
            m = int(line.split()[1])
            for row in lines[j + 1: j + 1 + m]:
                ids = list(map(int, row.split()))
                polys.append(ids[1:4])
    return points, np.array(polys, int)


def to_app(p):
    """MRI（x 左・y 後ろ・z 上、mm）→ アプリの向き（x 左・y 上・z 前、mm のまま）"""
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def volume(points, tris):
    a, b, c = points[tris[:, 0]], points[tris[:, 1]], points[tris[:, 2]]
    return abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0


def main():
    parts = {}
    for name in ["Left", "Right", "Ribcage"]:
        files = sorted(glob.glob(os.path.join(SRC, name, "state_*.vtk")))
        parts[name] = np.stack([read_vtk(f)[0] for f in files])
    surf = {"Left": read_vtk(os.path.join(SRC, "lungs_left_surface.vtk")), "Right": read_vtk(os.path.join(SRC, "lungs_right_surface.vtk"))}

    lungs = np.concatenate([parts["Left"], parts["Right"]], axis=1)
    flat = (lungs - lungs.mean(0)).reshape(len(lungs), -1)
    u, s, vt = np.linalg.svd(flat, full_matrices=False)
    signal = u[:, 0] * s[0]
    # 吸うと肺底が下がる（MRI の z が減る）ので、そのとき信号が大きくなる向きにそろえる
    base = lungs.mean(0)[:, 2] < np.percentile(lungs.mean(0)[:, 2], 15)
    if (vt[0].reshape(-1, 3)[base, 2]).mean() > 0:
        signal = -signal
    print("主成分の1つめが占める割合", round(float(s[0] ** 2 / (s ** 2).sum()), 3))

    # 呼気の終わり（谷）: 前後 2 時点より小さく、谷の間が 4 時点以上
    troughs = [i for i in range(2, len(signal) - 2) if signal[i] == signal[i - 2: i + 3].min()]
    clean = []
    for i in troughs:
        if not clean or i - clean[-1] >= 4:
            clean.append(i)
    cycles = [(a, b) for a, b in zip(clean, clean[1:]) if 4 <= b - a <= 20]
    periods = [(b - a) / 2.15 for a, b in cycles]
    print("呼吸の数", len(cycles), "周期の中央値", round(float(np.median(periods)), 2), "秒")

    all_points = {name: parts[name] for name in parts}
    sums = {name: np.zeros((PHASES,) + all_points[name].shape[1:]) for name in parts}
    counts = np.zeros(PHASES)
    vols = np.zeros(PHASES)
    for a, b in cycles:
        # 1呼吸の中を線形に補って位相の区間ごとに足す（はじめの谷の形からの変位）
        times = np.arange(a, b + 1)
        for k in range(PHASES):
            t = a + (b - a) * (k / PHASES)
            i0 = int(np.floor(t))
            f = t - i0
            i1 = min(i0 + 1, b)
            for name in parts:
                p = all_points[name]
                sums[name][k] += (p[i0] * (1 - f) + p[i1] * f) - p[a]
            v = 0.0
            for name in ["Left", "Right"]:
                p = all_points[name]
                pts = p[i0] * (1 - f) + p[i1] * f
                v += volume(pts[: len(surf[name][0])], surf[name][1])
            v0 = sum(volume(all_points[n][a][: len(surf[n][0])], surf[n][1]) for n in ["Left", "Right"])
            vols[k] += v - v0
        counts += 1
        del times
    mean = {name: sums[name] / counts[:, None, None] for name in parts}
    vols /= counts
    print("肺の容積の増え方（mL）", np.round(vols / 1000, 0).tolist())

    # アプリの肺の箱に合わせる
    app = json.load(open(os.path.join(ROOT, "data-raw", "motions", "app.json")))
    pts = lambda term: np.concatenate([np.array(app["elements"][e]).reshape(-1, 3) for e in app["terms"][term] if e in app["elements"]])
    app_lung = pts("lung")
    ref_lung = to_app(np.concatenate([parts["Left"][cycles[0][0]], parts["Right"][cycles[0][0]]]))
    lo_m, hi_m = ref_lung.min(0), ref_lung.max(0)
    lo_a, hi_a = app_lung.min(0), app_lung.max(0)
    scale = (hi_a - lo_a) / (hi_m - lo_m)  # m / mm
    print("MRI の肺の大きさ（mm）", np.round(hi_m - lo_m, 0), "アプリ（mm）", np.round((hi_a - lo_a) * 1000, 0))
    place = lambda p: lo_a + (to_app(p) - lo_m) * scale
    move = lambda d: to_app(d) * scale

    thorax = np.concatenate([app_lung, pts("ribs"), pts("sternum"), pts("diaphragm"), pts("costal-cartilages")])
    lo = thorax.min(0) - MARGIN
    hi = thorax.max(0) + MARGIN
    shape = np.ceil((hi - lo) / GRID).astype(int) + 1
    axes = [lo[k] + np.arange(shape[k]) * GRID for k in range(3)]
    nodes = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, 3)
    print("格子", shape.tolist(), len(nodes), "点")

    fields = {}
    for field, names in [("lung", ["Left", "Right"]), ("chest", ["Ribcage"])]:
        rest = np.concatenate([place(parts[n][cycles[0][0]]) for n in names])
        disp = np.concatenate([move(mean[n]) for n in names], axis=1)  # PHASES, N, 3（m）
        flat = disp.reshape(PHASES, -1)
        u, s, vt = np.linalg.svd(flat, full_matrices=False)
        share = np.cumsum(s ** 2) / (s ** 2).sum()
        print(field, "位相の変位を2つの形で表せる割合", round(float(share[1]), 4))
        modes = vt[:2].reshape(2, -1, 3)
        weights = u[:, :2] * s[:2]
        tree = cKDTree(rest)
        values = np.zeros((2, len(nodes), 3))
        known = np.zeros(len(nodes), bool)
        for i, near in enumerate(tree.query_ball_point(nodes, RADIUS)):
            if not near:
                continue
            d = np.linalg.norm(rest[near] - nodes[i], axis=1)
            w = np.exp(-((d / (RADIUS / 2)) ** 2))
            values[:, i] = (modes[:, near] * w[None, :, None]).sum(1) / w.sum()
            known[i] = True
        # 点の無い所はラプラス方程式で広げる（箱の縁は 0）
        grid = values.reshape(2, *shape, 3)
        fixed = known.reshape(shape)
        edge = np.zeros(tuple(shape), bool)
        edge[0, :, :] = edge[-1, :, :] = edge[:, 0, :] = edge[:, -1, :] = edge[:, :, 0] = edge[:, :, -1] = True
        free = ~fixed & ~edge
        grid[:, edge & ~fixed] = 0
        for _ in range(1500):
            avg = np.zeros_like(grid)
            for axis in (1, 2, 3):
                avg += np.roll(grid, 1, axis) + np.roll(grid, -1, axis)
            grid[:, free] = (avg / 6)[:, free]
        fields[field] = {
            "modes": [np.round(grid[m].reshape(-1) * 1e5).astype(int).tolist() for m in range(2)],  # 0.01mm 単位
            "weights": [[round(float(weights[k, m]), 4) for m in range(2)] for k in range(PHASES)],
        }
        peak = np.abs(disp).max(axis=(0, 1)) * 1000
        print(field, "変位の最大（mm, x y z）", np.round(peak, 1))

    out = {
        "source": "4DMRI moving meshes（Duetschler ほか, Zenodo 2022, doi:10.5281/zenodo.7052607, CC BY 4.0）の MRI1 の自由呼吸 47 回の平均",
        "phases": PHASES,
        "period": round(float(np.median(periods)), 2),
        "grid": {"origin": [round(float(v), 5) for v in lo], "step": GRID, "shape": shape.tolist()},
        "fields": fields,
        "volume": [round(float(v / 1000), 1) for v in vols],
    }
    os.makedirs(os.path.join(ROOT, "public", "motions"), exist_ok=True)
    path = os.path.join(ROOT, "public", "motions", "breathing.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("書いた", path, os.path.getsize(path), "バイト")


if __name__ == "__main__":
    main()
