# 肺区域（S1〜S10）の形を作る。
# 元の形は scripts/lung/export.mjs が data-raw/lung/input.json に書く（骨に合わせた Z-Anatomy の肺葉と、区域ごとの区域気管支・区域動脈の点。m）。
# 使い方: python3 scripts/lung/lung.py [--check]（numpy と scipy だけを使う。--check は確かめる断面の画像を data-raw/lung/ に書く＝PyMuPDF を使う）
# 出力: data-raw/lung/parts.json（区域ごとの形。m）。scripts/lung/index.mjs が Z-Anatomy の部品として読む（肺葉の形をもとにするので CC BY-SA）。
#
# 考え方: 肺区域は区域気管支の分布する範囲（『解剖学講義』p.275）。区域気管支と区域動脈は区域の中央をそろって走る（図5-37）。
# そこで肺葉ごとに、葉の中のボクセルを、どの区域の気管支・動脈にいちばん近いか（葉の中を通る道のり）で分ける。
# 道のりで分けるので、区域は葉の中でつながった1つの塊になり、頂を肺門に・底を肺の表面に向けた錐体のような形になる。
# 気管支・動脈の木は肺の表面まで届かないので、末梢は最も近い枝の続きとして分かれる（実際の区域の境と数 mm〜1cm ずれうる模式の形）。
# 面は surface nets で作り Taubin 法でならす。葉の表面にあたる点（元の面から SNAP 以内）は元の肺葉の面へ吸い付ける。
import json
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.sparse.csgraph import dijkstra

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kidney"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "nasal"))
import kidney  # noqa: E402
from kidney import load, majority, snap, voxel_graph, voxelize  # noqa: E402
from nasalseg import surface_nets, taubin  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "lung")
H = 1.0  # ボクセルの大きさ（mm）
SNAP = 1.2  # 葉の表面にあたる点を元の面へ吸い付ける距離（mm）
LEVEL = 0.56  # 面を取る値（0.5 だととなりの区域と面が重なる）
SMOOTH = 0.9  # 面を取る前にボクセルをぼかす広さ（ボクセル）
TRUNK = 0.3  # 根元からの距離が木の大きさのこの割合より手前（幹）は種にしない
EXTEND_FROM = 0.5  # 根元からの距離が木の大きさのこの割合より先の点を、表面までのばす
BLUR = 9.0  # 区域の境目をならす広さ（mm）
CHECK = "--check" in sys.argv
kidney.H = H  # kidney.py の voxelize・voxel_graph はこの大きさで数える

# 区域の名前（部品名）。S の番号は『解剖学講義』の表記
NAMES = {
    "s1": "apical segment", "s2": "posterior segment", "s3": "anterior segment", "s1+2": "apicoposterior segment",
    "s4": "lateral segment", "s5": "medial segment", "s6": "superior segment", "s7": "medial basal segment",
    "s8": "anterior basal segment", "s9": "lateral basal segment", "s10": "posterior basal segment",
}
LINGULA = {"s4": "superior lingular segment", "s5": "inferior lingular segment"}


def lobe_segments(P, F, segs):
    """1つの肺葉の中を区域に分ける。返り値 (ラベルの3次元配列, 原点, 区域の slug のリスト)"""
    lo = P.min(0) - 3
    hi = P.max(0) + 3
    shape = tuple(np.ceil((hi - lo) / H).astype(int) + 1)
    inside = ndi.binary_fill_holes(voxelize(P, F, lo, shape))
    graph, coords = voxel_graph(inside)
    index = -np.ones(shape, dtype=np.int64)
    index[tuple(coords.T)] = np.arange(len(coords))
    sources, owner = [], []
    allpts = [np.concatenate([np.array(seg["bronchi"]).reshape(-1, 3), np.array(seg["arteries"]).reshape(-1, 3)]) * 1000.0 for seg in segs]
    center = np.concatenate(allpts).mean(0)  # 葉の気管支・動脈の木のまん中（葉気管支の近く）
    for k, seg in enumerate(segs):
        pts = allpts[k]
        # 枝の先を、区域の根元（木のまん中にいちばん近い点）から先へ向かう向きに、葉の表面までのばす
        # （区域は頂を肺門に、底を肺の表面に向けた錐体なので、枝の向きの先はその区域になる。のばさないと、
        #  木の届かない肺の表面近くを、向きの違うとなりの区域の枝が取ってしまう）
        root = pts[np.argmin(np.linalg.norm(pts - center, axis=1))]
        d = pts - root
        r = np.linalg.norm(d, axis=1)
        tips = pts[r > EXTEND_FROM * r.max()][::7]
        dirs = d[r > EXTEND_FROM * r.max()][::7] / r[r > EXTEND_FROM * r.max()][::7, None]
        steps = np.arange(2.0, 160.0, 2.0)
        ext = (tips[:, None, :] + dirs[:, None, :] * steps[None, :, None]).reshape(-1, 3)
        ei = np.floor((ext - lo) / H).astype(int)
        inb = ((ei >= 0) & (ei < shape)).all(1)
        ext = ext[inb][inside[tuple(ei[inb].T)]]
        # 幹（根元に近い所）は肺門の近くで区域どうしが集まり、内側の深い所を取りすぎるので、種には枝の先の方だけを使う
        pts = np.concatenate([pts[r > TRUNK * r.max()], ext])
        ijk = np.floor((pts - lo) / H).astype(int)
        ok = ((ijk >= 0) & (ijk < shape)).all(1)
        ids = np.unique(index[tuple(ijk[ok].T)])
        ids = ids[ids >= 0]
        if not len(ids):
            raise SystemExit(f"{seg['side']} {seg['slug']}: 種が葉の中にありません")
        sources.append(ids)
        owner.append(np.full(len(ids), k + 1))
        print(f"  {seg['slug']}: 種 {len(ids)} ボクセル")
    src = np.concatenate(sources)
    own = np.zeros(len(coords), dtype=np.int16)
    own[src] = np.concatenate(owner)
    # 同じボクセルを2つの区域が取り合う所（区域の幹が葉気管支の近くで重なる）は、後から来た区域になる。数ボクセルなので構わない
    _, _, reached = dijkstra(graph, directed=False, indices=src, min_only=True, return_predecessors=True)
    labels = np.zeros(shape, dtype=np.int16)
    labels[tuple(coords.T)] = own[reached]
    # 境目をならす: 区域ごとの 0/1 の場を葉の中だけで BLUR でぼかし、いちばん大きい区域にする
    # （木の枝の先がとなりの区域へ指のように入りこんで、境目がぎざぎざになるのを防ぐ。体積はほとんど変わらない）
    weight = ndi.gaussian_filter(inside.astype(np.float32), BLUR / H) + 1e-6
    best = np.zeros(shape, dtype=np.float32)
    smooth = np.zeros(shape, dtype=np.int16)
    for k in range(1, len(segs) + 1):
        f = ndi.gaussian_filter((labels == k).astype(np.float32), BLUR / H) / weight
        better = f > best
        best[better] = f[better]
        smooth[better] = k
    labels = np.where(inside, smooth, 0).astype(np.int16)
    labels = majority(labels, inside, rounds=3)
    labels = islands(labels, inside, len(sources))
    return labels, lo, inside


def islands(labels, inside, n):
    """区域ごとにいちばん大きな塊だけを残し、ほかの塊（飛び地）はまわりで最も多い区域にする"""
    for _ in range(3):
        moved = 0
        for k in range(1, n + 1):
            comp, count = ndi.label(labels == k)
            if count <= 1:
                continue
            sizes = np.bincount(comp.ravel())
            sizes[0] = 0
            keep = sizes.argmax()
            for c in range(1, count + 1):
                if c == keep:
                    continue
                piece = comp == c
                ring = ndi.binary_dilation(piece) & ~piece & inside
                around = labels[ring]
                around = around[(around > 0) & (around != k)]
                if len(around):
                    labels[piece] = np.bincount(around).argmax()
                    moved += 1
        if not moved:
            break
    return labels


def surface(mask, origin, outer):
    f = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), SMOOTH)
    v, faces = surface_nets(f, LEVEL)
    v = taubin(v, faces, iterations=12)
    mm = origin + (v - 2 + 0.5) * H
    mm, _ = snap(mm, *outer, reach=SNAP)
    # 小さなかけら（三角形 60 未満）は捨てる
    import scipy.sparse as sp
    from scipy.sparse.csgraph import connected_components
    n = len(mm)
    adj = sp.coo_matrix((np.ones(len(faces) * 3), (np.repeat(faces[:, 0], 3), faces.ravel())), shape=(n, n))
    k, comp = connected_components(adj, directed=False)
    size = np.bincount(comp[faces[:, 0]], minlength=k)
    faces = faces[size[comp[faces[:, 0]]] >= 60]
    used = np.unique(faces)
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return mm[used] / 1000.0, remap[faces]


def check_image(name, labels, axis, frac):
    import fitz

    palette = np.array([(250, 248, 242), (230, 120, 110), (240, 180, 90), (240, 220, 110), (150, 200, 120), (100, 180, 170),
                        (110, 150, 220), (160, 120, 210), (220, 130, 190), (170, 170, 170), (120, 90, 70), (60, 120, 60)], dtype=np.uint8)
    k = int(labels.shape[axis] * frac)
    sl = np.take(labels, k, axis=axis)
    img = palette[np.clip(sl, 0, len(palette) - 1)]
    img = np.ascontiguousarray(np.transpose(img, (1, 0, 2))[::-1]) if axis != 1 else np.ascontiguousarray(np.transpose(img, (1, 0, 2)))
    img = np.repeat(np.repeat(img, 3, 0), 3, 1)
    pix = fitz.Pixmap(fitz.csRGB, img.shape[1], img.shape[0], img.tobytes(), 0)
    pix.save(os.path.join(DIR, f"check-{name}-{'xyz'[axis]}{int(frac * 100)}.png"))


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    parts = []
    for key, mesh in data["lobes"].items():
        side, lobe = key.split()
        segs = [s for s in data["segments"] if s["side"] == side and s["lobe"] == lobe]
        print(key, [s["slug"] for s in segs])
        P, F = load(mesh)
        labels, origin, inside = lobe_segments(P, F, segs)
        if CHECK:
            for axis, frac in ((2, 0.5), (0, 0.5), (1, 0.3), (1, 0.6)):
                check_image(f"{side}-{lobe}", labels, axis, frac)
        for k, seg in enumerate(segs):
            slug = seg["slug"]
            name = (LINGULA if side == "left" and slug in LINGULA else NAMES)[slug]
            V, Fs = surface(labels == k + 1, origin, (P, F))
            vol = (labels == k + 1).sum() * H ** 3 / 1000
            parts.append({"id": f"ZL_{slug.replace('+', '_')}_{side[0]}", "name": f"{side} {name} of lung ({slug})",
                          "positions": np.round(V, 6).ravel().tolist(), "indices": Fs.ravel().tolist()})
            print(f"  {side} {name} ({slug}): {vol:.0f} mL, {len(V)} 点 {len(Fs)} 三角形")
    json.dump({"version": 1, "parts": parts}, open(os.path.join(DIR, "parts.json"), "w"))


if __name__ == "__main__":
    main()
