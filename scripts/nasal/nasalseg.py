# NasalSeg（Zhang ほか, Scientific Data 2024。CC BY 4.0。https://zenodo.org/records/13893419）の CT の1例から、
# 鼻腔（下鼻道・中鼻道とそれ以外に分けたもの）・下鼻甲介と中鼻甲介（粘膜をふくむ形）・上顎洞・咽頭鼻部・骨の面を作る。
# 座標は CT の LPS（mm。x が本人の左・y が後ろ・z が上）。BodyParts3D への合わせ込みは scripts/nasal/index.mjs。
# 使い方: python3 scripts/nasal/nasalseg.py data-raw/nasalseg P065 data-raw/nasalseg/P065.json（numpy と scipy だけを使う）
#
# ラベル: 1＝右上顎洞 2＝左上顎洞 3＝右鼻腔 4＝左鼻腔 5＝咽頭鼻部（データの説明の順ではなく、位置で確かめた。LPS で x が小さいほど右）。
# 鼻腔のラベルは空気の通り道そのもの（鼻甲介と鼻中隔は入らない）なので、
# - 鼻甲介: 同じ高さ・同じ前後の位置で、内側の空気と外側の空気にはさまれた組織（鼻道の空気が外側に回り込む所）。大きい2つの塊のうち低い方が下鼻甲介。
#   鼻甲介の付け根（外側の壁につく所）は外側に空気が無いので入らない。上鼻甲介は小さく、縦 1.5mm の CT では分けられない。
# - 鼻道: 空気の点から真上へ進んで最初に当たる組織が鼻甲介ならその鼻甲介の鼻道。ただし冠状断ごとに鼻甲介の最も内側の縁より内側（鼻中隔との間）と、
#   鼻甲介の無い冠状断（前後の端より先）の空気は鼻道に入れない（総鼻道・鼻前庭などとして「鼻腔のそのほか」に残す）。
# 面は surface nets（ボクセルの境目に頂点を置く）で作り、Taubin 法でならす（縮まないならし方）。
import gzip
import json
import re
import sys

import numpy as np
import scipy.sparse as sp
from scipy import ndimage as ndi

# ---- NRRD を読む（pynrrd が書いた gzip / raw）----
TYPES = {"int16": np.int16, "short": np.int16, "uint8": np.uint8, "uchar": np.uint8, "int8": np.int8, "uint16": np.uint16, "int32": np.int32, "float": np.float32, "double": np.float64}


def read_nrrd(path):
    raw = open(path, "rb").read()
    head_end = raw.index(b"\n\n")
    head = raw[:head_end].decode("latin1")
    fields = {}
    for line in head.split("\n")[1:]:
        if line.startswith("#") or ":" not in line:
            continue
        k, v = line.split(":", 1)
        fields[k.strip()] = v.strip()
    body = raw[head_end + 2:]
    if fields.get("encoding") == "gzip":
        body = gzip.decompress(body)
    sizes = [int(s) for s in fields["sizes"].split()]
    dt = np.dtype(TYPES[fields["type"]]).newbyteorder("<" if fields.get("endian", "little") == "little" else ">")
    data = np.frombuffer(body, dtype=dt, count=int(np.prod(sizes))).reshape(sizes, order="F")
    dirs = [[float(x) for x in d.split(",")] for d in re.findall(r"\(([^)]*)\)", fields["space directions"])]
    origin = [float(x) for x in re.findall(r"\(([^)]*)\)", fields["space origin"])[0].split(",")]
    affine = np.eye(4)
    affine[:3, :3] = np.array(dirs).T
    affine[:3, 3] = origin
    return np.asarray(data), affine, fields.get("space")


# ---- Surface nets ----
CORNERS = np.array([[i & 1, (i >> 1) & 1, (i >> 2) & 1] for i in range(8)])
EDGES = [(a, b) for a in range(8) for b in range(8) if a < b and np.abs(CORNERS[a] - CORNERS[b]).sum() == 1]


def surface_nets(f, level=0.5):
    """f: 3次元配列（ボクセル）。返り値 (verts[N,3]（ボクセル座標）, faces[M,3])。面は内側から外へ向く法線（右手）"""
    f = np.asarray(f, dtype=np.float32)
    nx, ny, nz = f.shape
    inside = f > level
    cs = [inside[c[0]:nx - 1 + c[0], c[1]:ny - 1 + c[1], c[2]:nz - 1 + c[2]] for c in CORNERS]
    count = sum(c.astype(np.int8) for c in cs)
    active = (count > 0) & (count < 8)
    idx = -np.ones(active.shape, dtype=np.int64)
    cells = np.argwhere(active)
    idx[active] = np.arange(len(cells))
    # 頂点: セルの辺の交点の平均
    fs = [f[c[0]:nx - 1 + c[0], c[1]:ny - 1 + c[1], c[2]:nz - 1 + c[2]][active] for c in CORNERS]
    ins = [c[active] for c in cs]
    acc = np.zeros((len(cells), 3))
    num = np.zeros(len(cells))
    for a, b in EDGES:
        cross = ins[a] != ins[b]
        t = np.clip((level - fs[a]) / np.where(fs[b] - fs[a] == 0, 1e-9, fs[b] - fs[a]), 0, 1)
        p = CORNERS[a][None, :] + t[:, None] * (CORNERS[b] - CORNERS[a])[None, :]
        acc[cross] += p[cross]
        num[cross] += 1
    verts = cells + acc / num[:, None]
    faces = []
    # 軸ごとの辺で符号が変わる所に、辺を囲む4つのセルで四角形
    for axis in range(3):
        u, v = [(1, 2), (0, 2), (0, 1)][axis]
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        a = inside[tuple(sl0)]
        b = inside[tuple(sl1)]
        change = a != b
        # 4つのセルが取れる所だけ（u, v の向きに 1 以上）
        mask = np.zeros_like(change)
        s = [slice(None)] * 3
        s[u] = slice(1, None)
        s[v] = slice(1, None)
        mask[tuple(s)] = change[tuple(s)]
        # u, v の上端（セルの範囲の外）は除く
        lim = [slice(None)] * 3
        lim[u] = slice(0, inside.shape[u] - 1)
        lim[v] = slice(0, inside.shape[v] - 1)
        m2 = np.zeros_like(mask)
        m2[tuple(lim)] = mask[tuple(lim)]
        pts = np.argwhere(m2)
        outward = a[tuple(pts.T)]  # 内→外 が +axis の向き
        def cell(du, dv):
            q = pts.copy()
            q[:, u] -= du
            q[:, v] -= dv
            return idx[tuple(q.T)]
        c00, c10, c11, c01 = cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)
        quad = np.stack([c00, c10, c11, c01], 1)
        # (u, v, axis) が右手系かで回り方を合わせる
        right = (axis, u, v) in [(0, 1, 2), (1, 2, 0), (2, 0, 1)]
        flip = outward if right else ~outward
        quad[~flip] = quad[~flip][:, ::-1]
        ok = (quad >= 0).all(1)
        quad = quad[ok]
        faces.append(np.concatenate([quad[:, [0, 1, 2]], quad[:, [0, 2, 3]]]))
    faces = np.concatenate(faces)
    return verts, faces


def taubin(verts, faces, iterations=20, lam=0.5, mu=-0.53):
    n = len(verts)
    i = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2], faces[:, 1], faces[:, 2], faces[:, 0]])
    j = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 0], faces[:, 1], faces[:, 2]])
    A = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    A.data[:] = 1
    deg = np.asarray(A.sum(1)).ravel()
    deg[deg == 0] = 1
    W = sp.diags(1 / deg) @ A
    v = verts.copy()
    for _ in range(iterations):
        v = v + lam * (W @ v - v)
        v = v + mu * (W @ v - v)
    return v


def main(D, case, out):
    img, aff, space = read_nrrd(f"{D}/images/{case}_img.nrrd")
    lab, _, _ = read_nrrd(f"{D}/labels/{case}_seg.nrrd")
    spacing = np.abs(np.diag(aff[:3, :3]))
    XY = spacing[0]
    F = spacing[2] / XY
    hu = ndi.zoom(img.astype(np.float32), (1, 1, F), order=1)
    def to_mm(v):
        q = v.copy()
        q[:, 2] *= XY / spacing[2]
        return q @ aff[:3, :3].T + aff[:3, 3]
    meshes = []
    def add(name, field, level=0.5, smooth=16, sigma=(0.5, 0.5, 1.4)):
        # z は 1.5mm 間隔を3倍に補ったので、段差が出ないよう z を強めにならす
        field = ndi.gaussian_filter(field.astype(np.float32), sigma)
        pad = np.pad(field, 1)
        v, f = surface_nets(pad, level)
        v = taubin(v - 1, f, smooth)
        mm = to_mm(v)
        # 体積が負なら裏返し
        a, b, c = mm[f[:, 0]], mm[f[:, 1]], mm[f[:, 2]]
        vol = np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6
        if vol < 0:
            f = f[:, ::-1]
        meshes.append({"name": name, "positions": np.round(mm, 3).ravel().tolist(), "indices": f.ravel().tolist()})
        print(name, len(v), "verts", f"{abs(vol) / 1000:.1f} ml")

    soft = lambda k: np.clip(ndi.zoom(ndi.gaussian_filter((lab == k).astype(np.float32), (0.6, 0.6, 0.5)), (1, 1, F), order=3), 0, 1)
    # 1=右上顎洞 2=左上顎洞 3=右鼻腔 4=左鼻腔 5=咽頭鼻部（位置で確かめた。LPS で x が小さいほど右）
    for k, name in ((1, "right maxillary sinus"), (2, "left maxillary sinus"), (5, "nasopharynx")):
        add(name, soft(k))
    for side, k in (("right", 3), ("left", 4)):
        s = soft(k)
        N = s > 0.5
        # 鼻甲介: 同じ高さ・同じ前後の位置で、内側の空気と外側の空気にはさまれた組織（鼻道の空気が外側に回り込む所）
        left = np.maximum.accumulate(N, axis=0)
        right = np.maximum.accumulate(N[::-1], axis=0)[::-1]
        C = ndi.binary_opening(left & right & ~N & (hu > -500), iterations=1)
        lb, n = ndi.label(C)
        sizes = ndi.sum(C, lb, range(1, n + 1))
        big = [i + 1 for i in np.argsort(-sizes)[:2] if sizes[i] * XY ** 3 > 500]
        assert len(big) == 2, sizes
        # 低い方が下鼻甲介
        zc = [np.argwhere(lb == i)[:, 2].mean() for i in big]
        inf_, mid_ = (big[0], big[1]) if zc[0] < zc[1] else (big[1], big[0])
        conchae = {"inferior": ndi.binary_closing(lb == inf_, iterations=2) & ~N, "middle": ndi.binary_closing(lb == mid_, iterations=2) & ~N}
        for which, m in conchae.items():
            add(f"{side} {which} nasal concha (mucosa)", ndi.gaussian_filter(m.astype(np.float32), 0.8))
        # 鼻道: 空気の点から真上へ進んで最初に当たる組織が、鼻甲介（少し太らせたもの）なら、その鼻甲介の鼻道
        grow = {w: ndi.binary_dilation(m, iterations=3) for w, m in conchae.items()}
        nz = N.shape[2]
        # 真上の最初の組織: 各 (x, y) の列で、z より上の最初の「空気でない」点
        meatus = np.zeros(N.shape, dtype=np.uint8)  # 0=ほか 1=下鼻道 2=中鼻道
        ks = np.arange(nz)
        for which, code in (("inferior", 1), ("middle", 2)):
            g = grow[which]
            # 上から下へ: next_tissue[z] = z より上で最初の空気でない点が g か
            hit = np.zeros(N.shape[:2], dtype=bool)
            for z in range(nz - 1, -1, -1):
                meatus[:, :, z][N[:, :, z] & hit & (meatus[:, :, z] == 0)] = code
                solid = ~N[:, :, z]
                hit = np.where(solid, g[:, :, z], hit)
        # 鼻道は鼻甲介より外側の空気。冠状断ごとに鼻甲介の最も内側の縁より内側（鼻中隔との間）は総鼻道として残す。
        # 鼻甲介の無い冠状断（前後の端より先）には鼻道は無い
        xs = np.arange(N.shape[0])[:, None]
        for which, code in (("inferior", 1), ("middle", 2)):
            m = conchae[which].any(2)  # (x, y)
            has = m.any(0)
            if side == "right":
                inner = np.where(has, (m * xs).max(0), -1)
                medial = xs > inner[None]
            else:
                inner = np.where(has, np.where(m, xs, 10 ** 6).min(0), 10 ** 6)
                medial = xs < inner[None]
            drop = (medial | ~has[None]).astype(bool)  # (x, y)
            meatus[(meatus == code) & drop[:, :, None]] = 0
        # 小さなかけらは周りに合わせる（成分ごとに最大のものだけ残す）
        for code in (1, 2):
            lbm, nm = ndi.label(meatus == code)
            if nm > 1:
                sz = ndi.sum(meatus == code, lbm, range(1, nm + 1))
                keep = np.argmax(sz) + 1
                meatus[(lbm != keep) & (lbm > 0)] = 0
        names = {0: f"{side} nasal cavity proper", 1: f"{side} inferior nasal meatus", 2: f"{side} middle nasal meatus"}
        for code, name in names.items():
            piece = (meatus == code) & N
            # 部品ごとに閉じた面。外の縁は鼻腔全体のなめらかな面に合わせる（s で重み）
            field = np.minimum(ndi.gaussian_filter(piece.astype(np.float32), 0.7) * 2, 1) * s
            add(name, field)
    # 骨（合わせ込み用）。半分の細かさで
    hb = ndi.zoom(hu, 0.5, order=1)
    bone = ndi.gaussian_filter((hb > 250).astype(np.float32), 0.7)
    pad = np.pad(bone, 1)
    v, f = surface_nets(pad, 0.5)
    v = taubin(v - 1, f, 6) * 2
    mm = to_mm(v)
    meshes.append({"name": "bone", "positions": np.round(mm, 2).ravel().tolist(), "indices": f.ravel().tolist()})
    print("bone", len(v))
    json.dump({"case": case, "space": space, "meshes": meshes}, open(out, "w"))


if __name__ == "__main__":
    main(*sys.argv[1:4])
