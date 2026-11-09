# 壁側胸膜（肋骨胸膜・横隔胸膜・縦隔胸膜・胸膜頂）と胸膜洞（肋骨横隔洞・肋骨縦隔洞）の形を作る。
# 元の形は scripts/lung/export.mjs が data-raw/lung/input.json に書く（Z-Anatomy の肺葉と、胸壁・横隔膜・縦隔の器官。m）。
# 使い方: python3 scripts/lung/pleura.py [--check]（numpy と scipy。--check は断面の画像を data-raw/lung/ に書く＝PyMuPDF）
# 出力: data-raw/lung/pleura.json（部品ごとの形。m）。scripts/lung/index.mjs が Z-Anatomy の部品として読む（肺葉の形をもとにするので CC BY-SA）。
#
# 考え方（『解剖学講義』p.281〜282）: 壁側胸膜は肺を包む袋で、ふだんは肺の面にほぼ沿うが、肺の前縁と下縁では肺の届かない
# すき間（胸膜洞）をつくる。モデルでは、肺の下の横隔膜と胸壁の間、心臓の前の胸壁と縦隔の間にすき間がある。そこで
# - 袋 = 肺から GAP の所まで ＋ 肺の下縁から横隔膜と胸壁の間のすき間を下へたどった所（深さは前 25・外側 60・後ろ 40mm を角度で補う。
#   体表では肺の下縁と胸膜の下縁は中腋窩線で最も離れる）＋ 肺の前縁から胸壁と縦隔の間のすき間を正中へたどった所。
# - 袋の面を、横隔膜に接する所＝横隔胸膜、肺尖より上の所（肺尖から DOME 以内）＝胸膜頂、縦隔に向く所＝縦隔胸膜、残り＝肋骨胸膜に分ける。
# - 胸膜洞 = 袋のうち肺から RECESS_GAP より離れた所。下のすき間から来たものが肋骨横隔洞、前のすき間から来たものが肋骨縦隔洞。
# 胸壁などは閉じた形とは限らないので、面の上の点を並べたボクセル（壁）として扱う。
import json
import os
import sys

import numpy as np
import scipy.sparse as sp
from scipy import ndimage as ndi
from scipy.sparse.csgraph import connected_components, dijkstra

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kidney"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "nasal"))
import kidney  # noqa: E402
from kidney import load, voxel_graph, voxelize  # noqa: E402
from nasalseg import surface_nets, taubin  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "lung")
H = 1.5  # ボクセルの大きさ（mm）
GAP = 2.5  # 肺の面と壁側胸膜の間（mm。半透明の膜が肺の面と重なってちらつかないように）
DEPTH = {90: 25.0, 0: 60.0, -90: 40.0, 180: 25.0, -180: 25.0}  # 肋骨横隔洞の深さ（mm。角度は外側 0・前 90・後ろ -90）
SLIT_D = 9.0  # 肋骨横隔洞: 横隔膜からこの距離までのすき間（mm）
SLIT_W = 15.0  # 肋骨横隔洞: 胸壁からこの距離まで（mm）
CM_NEAR = 14.0  # 肋骨縦隔洞: 胸壁と縦隔の両方からこの距離までのすき間（mm）
CM_DEPTH = 40.0  # 肋骨縦隔洞: 肺の前縁からたどる長さ（mm）
CM_TOP = 1250.0  # 肋骨縦隔洞: この高さ（mm。気管分岐部のすぐ下）より下だけ（心臓の前。上は胸腺などのある前縦隔）
CM_MID = 4.0  # 肋骨縦隔洞: 正中からこれより外側（mm）
RADIAL = 3.0  # 肋骨横隔洞: 肺の下部のいちばん外の半径からこれより外へは出さない（mm）
SKIRT = 9.0  # 肋骨横隔洞の穴を埋める筒の厚さ（mm）
SKIRT_REACH = 40.0  # 帯からこの距離までの穴を埋める（mm）
CD_CLOSE = 12.0  # 肋骨横隔洞のちぎれた所・穴（横隔膜が胸壁にぴったり付いてすき間の無い所）を閉じる広さ（mm）
CM_LUNG = 18.0  # 肋骨縦隔洞: 肺の前縁からこの距離まで（mm）
WALL_CLOSE = 9.0  # 胸壁の肋骨の間のすき間を閉じる広さ（mm）
DOME = 25.0  # 胸膜頂: 肺尖からこの高さまで（mm）
RECESS_GAP = 5.0  # 胸膜洞: 肺からこれより離れた袋の中（mm）
CHECK = "--check" in sys.argv
kidney.H = H
SLUGS = {"costal pleura": "costal", "diaphragmatic pleura": "diaphragmatic", "mediastinal pleura": "mediastinal", "cervical pleura": "cervical",
         "costodiaphragmatic recess": "costodiaphragmatic", "costomediastinal recess": "costomediastinal"}  # 部品ID ZP_<これ>_<r|l>


def surface_points(P, F, step):
    """三角形を辺が step より短くなるまで4つに分け、点を返す（閉じていない膜や筋も壁として扱うため）"""
    T = P[F]
    pts = [P]
    while len(T):
        e = np.max(np.linalg.norm(T[:, [1, 2, 0]] - T, axis=2), axis=1)
        pts.append(T.mean(1))
        big = T[e > step]
        if not len(big):
            break
        a, b, c = big[:, 0], big[:, 1], big[:, 2]
        ab, bc, ca = (a + b) / 2, (b + c) / 2, (c + a) / 2
        T = np.concatenate([np.stack(t, 1) for t in ((a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca))])
        pts.append(np.concatenate([ab, bc, ca]))
    return np.concatenate(pts)


def mark(meshes, lo, shape):
    m = np.zeros(shape, bool)
    for mesh in meshes:
        P, F = load(mesh)
        if (P.max(0) < lo).any() or (P.min(0) > lo + np.array(shape) * H).any():
            continue
        q = np.floor((surface_points(P, F, H * 0.5) - lo) / H).astype(int)
        ok = ((q >= 0) & (q < shape)).all(1)
        m[tuple(q[ok].T)] = True
    return m


def geodesic(allowed, start, limit):
    """allowed の中を start から歩いた道のり（mm）。limit より遠い所は inf"""
    graph, coords = voxel_graph(allowed)
    index = -np.ones(allowed.shape, dtype=np.int64)
    index[tuple(coords.T)] = np.arange(len(coords))
    src = index[start & allowed]
    d = dijkstra(graph, directed=False, indices=src[src >= 0], min_only=True, limit=limit)
    out = np.full(allowed.shape, np.inf)
    out[tuple(coords.T)] = d
    return out


def depth_at(angle):
    keys = sorted(DEPTH)
    return np.interp(angle, keys, [DEPTH[k] for k in keys])


def side_pleura(side, data):
    s = -1.0 if side == "right" else 1.0  # 外側の向き（x）
    lobes = [load(m) for k, m in data["lobes"].items() if k.startswith(side)]
    PL = np.concatenate([P for P, _ in lobes])
    lo = PL.min(0) - [25, 90, 25]
    hi = PL.max(0) + [25, 15, 25]
    if side == "right":
        hi[0] = max(hi[0], 15)
    else:
        lo[0] = min(lo[0], -15)
    shape = tuple(np.ceil((hi - lo) / H).astype(int) + 1)
    grid = lambda axis: lo[axis] + (np.arange(shape[axis]) + 0.5) * H  # noqa: E731
    X, Y, Z = np.meshgrid(grid(0), grid(1), grid(2), indexing="ij")
    L = np.zeros(shape, bool)
    for P, F in lobes:
        L |= ndi.binary_fill_holes(voxelize(P, F, lo, shape))
    # 胸壁: 肋骨と肋間筋の面の点を、肋骨の間のすき間ごと閉じて1枚の壁にする（袋が肋間に入りこまないように）
    W = ndi.binary_closing(mark(data["thorax"]["wall"], lo, shape), kidney.ball(WALL_CLOSE), border_value=0)
    W = ndi.binary_dilation(W)
    D = ndi.binary_dilation(mark(data["thorax"]["diaphragm"], lo, shape))
    M = ndi.binary_dilation(mark(data["thorax"]["mediastinum"], lo, shape))
    M |= s * X < -1.0  # 正中より向こう側は使わない
    free = ~(L | W | D | M)
    dL = ndi.distance_transform_edt(~L) * H
    dW = ndi.distance_transform_edt(~W) * H
    dD = ndi.distance_transform_edt(~D) * H
    dM = ndi.distance_transform_edt(~M) * H
    core = (dL <= GAP) & ~L & free
    # 肋骨横隔洞: 横隔膜と胸壁の間のすき間を、肺のまわりから下へたどる（深さは角度で変える）
    cx, cz = PL[:, 0].mean(), PL[:, 2].mean()
    angle = np.degrees(np.arctan2(Z - cz, s * (X - cx)))
    ylow = PL[:, 1].min()
    # 角度ごと（10°）の肺の下縁の高さ。胸膜の下縁はそれより DEPTH だけ下
    sector = np.round(angle / 10.0).astype(int)
    lowest = {}
    li = np.argwhere(L)
    la = sector[tuple(li.T)]
    for k in np.unique(la):
        lowest[k] = Y[tuple(li[la == k].T)].min()
    keys = np.array(sorted(lowest))
    low = np.interp(angle / 10.0, keys, [lowest[k] for k in keys])
    # 角度ごとの肺の下部のいちばん外の半径。下位の肋間のすき間から胸郭の外へはみ出さないよう、それより RADIAL より外へは出さない
    radius = np.hypot(X - cx, Z - cz)
    reach = {}
    near_low = li[Y[tuple(li.T)] < low[tuple(li.T)] + 25]
    sl = sector[tuple(near_low.T)]
    rl = radius[tuple(near_low.T)]
    for k in np.unique(sl):
        reach[k] = rl[sl == k].max()
    rk = np.array(sorted(reach))
    rmax = np.interp(angle / 10.0, rk, [reach[k] for k in rk])
    slit = free & (dD <= SLIT_D) & (dW <= SLIT_W) & (Y < low + 15) & (Y >= low - depth_at(angle)) & (radius <= rmax + RADIAL)
    slit = ndi.binary_opening(slit, kidney.ball(3.0))
    lab, _ = ndi.label(slit | core)
    touch = np.unique(lab[core])
    cd = slit & np.isin(lab, touch[touch > 0])
    # 横隔膜の肋骨部の筋束と肋骨の間でちぎれた所や、横隔膜が胸壁に付いてすき間の無い所を閉じて、肺の下をめぐる1つの帯にする
    # （ここでは横隔膜・胸壁と少し重なってよい。実際の胸膜もその2つの間にある）
    cd = ndi.binary_closing(cd | core, kidney.ball(CD_CLOSE)) & ~L & (Y < low + 15) & (Y >= low - depth_at(angle)) & (radius <= rmax + RADIAL)
    # まだ残る穴（すき間がまったく無い所）は、肺の下部の外の縁から内へ SKIRT の厚さの筒（深さの範囲だけ）で、近くの帯から埋める
    skirt = (Y < low + 3) & (Y >= low - depth_at(angle)) & (radius <= rmax + RADIAL) & (radius >= rmax - SKIRT) & ~L
    cd |= skirt & (ndi.distance_transform_edt(~cd) * H <= SKIRT_REACH)
    # 肋骨縦隔洞: 胸壁と縦隔の間のすき間を、肺の前のまわりから正中へたどる
    gap2 = free & (dW <= CM_NEAR) & (dM <= CM_NEAR) & (Z > cz) & (Y < CM_TOP) & (Y > low + 25) & (s * X > CM_MID) & (dL <= CM_LUNG)
    g2 = geodesic(gap2 | core, core, CM_DEPTH)
    cm = gap2 & np.isfinite(g2) & ~cd
    sac = L | core | cd | cm
    sac = ndi.binary_closing(sac, kidney.ball(5.0))
    sac = ndi.binary_fill_holes(sac)
    lab, n = ndi.label(sac)
    sac = lab == np.bincount(lab.ravel())[1:].argmax() + 1
    recess = sac & (dL > RECESS_GAP)
    # 胸膜洞を2つに分ける: 下のすき間に近いものは肋骨横隔洞、前のすき間に近いものは肋骨縦隔洞
    d_cd = ndi.distance_transform_edt(~cd) if cd.any() else np.full(shape, np.inf)
    d_cm = ndi.distance_transform_edt(~cm) if cm.any() else np.full(shape, np.inf)
    rec_cd = recess & (d_cd <= d_cm) & (Y < PL[:, 1].min() + 40)
    rec_cm = recess & ~rec_cd
    print(f"{side}: 袋 {sac.sum() * H ** 3 / 1000:.0f} mL（肺 {L.sum() * H ** 3 / 1000:.0f} mL）、肋骨横隔洞 {rec_cd.sum() * H ** 3 / 1000:.0f} mL、肋骨縦隔洞 {rec_cm.sum() * H ** 3 / 1000:.0f} mL、肺の下端 {ylow:.0f}")
    if CHECK:
        check(side, lo, shape, L, W, D, M, sac, rec_cd, rec_cm)
    return dict(lo=lo, shape=shape, sac=sac, rec_cd=rec_cd, rec_cm=rec_cm, dW=dW, dD=dD, dM=dM, ytop=PL[:, 1].max(), s=s, cx=cx, cz=cz)


def mesh_from(mask, lo, sigma=1.0, level=0.5):
    f = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), sigma)
    v, faces = surface_nets(f, level)
    v = taubin(v, faces, iterations=12)
    return lo + (v - 2 + 0.5) * H, faces


def keep_big(V, F, min_faces=200):
    n = len(V)
    adj = sp.coo_matrix((np.ones(len(F) * 3), (np.repeat(F[:, 0], 3), F.ravel())), shape=(n, n))
    k, comp = connected_components(adj, directed=False)
    size = np.bincount(comp[F[:, 0]], minlength=k)
    F = F[size[comp[F[:, 0]]] >= min_faces]
    used = np.unique(F)
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return V[used], remap[F]


def face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def split_sac(r):
    """袋の面を、横隔胸膜・胸膜頂・縦隔胸膜・肋骨胸膜に分ける。返り値 {名前: (点, 三角形)}"""
    V, F = mesh_from(r["sac"], r["lo"], sigma=2.5)
    V, F = keep_big(V, F)
    C = V[F].mean(1)
    ijk = np.clip(np.floor((C - r["lo"]) / H).astype(int), 0, np.array(r["shape"]) - 1)
    at = lambda field: field[tuple(ijk.T)]  # noqa: E731
    N = face_normals(V, F)
    medial = -r["s"] * N[:, 0]
    label = np.full(len(F), 0)  # 0 肋骨胸膜・1 横隔胸膜・2 縦隔胸膜・3 胸膜頂
    label[(medial > 0.35) & (at(r["dW"]) > 6)] = 2
    rad = np.stack([C[:, 0] - r["cx"], np.zeros(len(C)), C[:, 2] - r["cz"]], 1)
    rad /= np.linalg.norm(rad, axis=1, keepdims=True) + 1e-9
    outward = (N * rad).sum(1)
    label[(at(r["dD"]) <= 7) & (N[:, 1] < 0.3) & (outward < 0.5)] = 1  # 横隔膜に接し、外（胸壁）を向かない所
    label[C[:, 1] > r["ytop"] - DOME] = 3
    # となりの三角形の多数決でならす（境目の飛び地をなくす）
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    fid = np.tile(np.arange(len(F)), 3)
    key = np.sort(e, 1)
    order = np.lexsort((key[:, 1], key[:, 0]))
    ks, fs = key[order], fid[order]
    same = (ks[1:] == ks[:-1]).all(1)
    a, b = fs[:-1][same], fs[1:][same]
    adj = sp.coo_matrix((np.ones(2 * len(a)), (np.concatenate([a, b]), np.concatenate([b, a]))), shape=(len(F), len(F))).tocsr()
    for _ in range(6):
        votes = np.stack([adj @ (label == k) + 0.5 * (label == k) for k in range(4)])
        label = votes.argmax(0)
    out = {}
    for k, name in enumerate(("costal pleura", "diaphragmatic pleura", "mediastinal pleura", "cervical pleura")):
        Fk = F[label == k]
        if not len(Fk):
            continue
        used = np.unique(Fk)
        remap = -np.ones(len(V), dtype=np.int64)
        remap[used] = np.arange(len(used))
        out[name] = (V[used], remap[Fk])
    return out


def check(side, lo, shape, L, W, D, M, sac, rec_cd, rec_cm):
    import fitz

    for axis, fracs in ((2, (0.3, 0.5, 0.7)), (0, (0.5,))):
        for fr in fracs:
            k = int(shape[axis] * fr)
            img = np.full((shape[1], shape[2 if axis == 0 else 0], 3), 250, np.uint8)
            for m, c in ((sac, (200, 225, 245)), (rec_cd, (90, 150, 230)), (rec_cm, (90, 200, 160)), (L, (230, 150, 140)), (W, (210, 200, 170)), (D, (150, 60, 60)), (M, (150, 150, 150))):
                sl = np.take(m, k, axis=axis)
                img[sl.T if axis == 2 else sl] = c
            img = np.repeat(np.repeat(img[::-1], 3, 0), 3, 1)
            fitz.Pixmap(fitz.csRGB, img.shape[1], img.shape[0], np.ascontiguousarray(img).tobytes(), 0).save(os.path.join(DIR, f"pleura-{side}-{'xyz'[axis]}{int(fr * 100)}.png"))


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    parts = []
    for side in ("right", "left"):
        r = side_pleura(side, data)
        pieces = split_sac(r)
        for slug, mask, name in (("cd", r["rec_cd"], "costodiaphragmatic recess"), ("cm", r["rec_cm"], "costomediastinal recess")):
            if mask.sum() * H ** 3 < 2000:
                print(f"  {side} {name}: 小さすぎるので作らない")
                continue
            V, F = keep_big(*mesh_from(mask, r["lo"], sigma=2.0), min_faces=300)
            pieces[name] = (V, F)
        for name, (V, F) in pieces.items():
            slug = SLUGS[name]
            parts.append({"id": f"ZP_{slug}_{side[0]}", "name": f"{side} {name}", "positions": np.round(V / 1000.0, 6).ravel().tolist(), "indices": F.ravel().tolist()})
            print(f"  {side} {name}: {len(V)} 点 {len(F)} 三角形")
    json.dump({"version": 1, "parts": parts}, open(os.path.join(DIR, "pleura.json"), "w"))


if __name__ == "__main__":
    main()
