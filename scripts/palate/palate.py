# 鼻中隔（粘膜をふくむ形）と硬口蓋の粘膜を作る。
# 元の形は scripts/palate/export.mjs が data-raw/palate/input.json に書く（NasalSeg の CT から作った左右の鼻腔と、BodyParts3D の鋤骨・篩骨・
# 鼻中隔軟骨・上顎骨・口蓋骨・上の歯肉・上の歯。m）。
# 使い方: python3 scripts/palate/palate.py [--check]（numpy と scipy だけを使う。--check は確かめる絵を data-raw/palate/ に書く＝PIL を使う）
# 出力: data-raw/palate/parts.json（部品ごとの形。m）。scripts/made/index.mjs が BodyParts3D の部品として読む
# （NasalSeg と BodyParts3D はどちらも CC BY 4.0 なので、BodyParts3D の GLB に入る）。
#
# 考え方（0.25mm のボクセル）:
# - 鼻中隔: 左右の鼻腔の空気の間の仕切り。左右に並ぶ (y, z) の列ごとに、右の鼻腔の空気のいちばん左の点と左の鼻腔のいちばん右の点の間
#   （間が SEPTUM_MAX 以内のとき。まわりを鼻中隔に囲まれた厚い所も入れる）を鼻中隔とする。前後・上下の列のぎざぎざは (y, z) の面でならす。中に鋤骨・篩骨の垂直板・鼻中隔軟骨が入る。
# - 硬口蓋の粘膜: BodyParts3D の「上の歯肉」は口蓋の全体をおおう1つの形なので、歯列の内側（歯の並びを (x, z) の面に映し、いちばん後ろの
#   大臼歯の間を後ろへ歯肉の端までのばして囲んだ所）で、歯から PALATE_GAP より離れた所を硬口蓋の粘膜、残りを歯肉に分ける。
#   分けた2つは元の歯肉の面へ吸い付ける（scripts/made/index.mjs が元の歯肉をこの2つに置きかえる）。
import json
import os
import sys

import numpy as np
from scipy import ndimage as ndi

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ear"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kidney"))
import ear  # noqa: E402
import kidney  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "palate")
H = 0.25
SEPTUM_MAX = 7.0  # 鼻中隔とみなす左右の空気の間の幅の上限（mm）
SEPTUM_BONE = 2.0  # 鼻中隔に入れる鋤骨・篩骨・鼻中隔軟骨の、正中からの幅（mm）
PALATE_GAP = 3.0  # 硬口蓋の粘膜を歯から離す距離（歯の頚のまわりの歯肉の幅、mm）
CHECK = "--check" in sys.argv


def load(list_):
    Ps, Fs, o = [], [], 0
    for m in list_:
        P, F = kidney.load(m)
        Ps.append(P)
        Fs.append(F + o)
        o += len(P)
    return np.vstack(Ps), np.vstack(Fs)


def septum(M):
    air_pts = np.vstack([M["airRight"][0], M["airLeft"][0]])
    lo = air_pts.min(0) - 2
    hi = air_pts.max(0) + 2
    lo[0], hi[0] = -12, 12
    grid = ear.Grid(lo, hi, H)
    R = grid.voxelize(*M["airRight"])
    L = grid.voxelize(*M["airLeft"])
    nx = grid.shape[0]
    xs = np.arange(nx)[:, None, None]
    big = 10 ** 6
    r_edge = np.where(R, xs, -1).max(0)  # 右の空気のいちばん左（x が大きい）の添字
    l_edge = np.where(L, xs, big).min(0)  # 左の空気のいちばん右の添字
    gap = (l_edge - r_edge - 1) * H
    ok = (r_edge >= 0) & (l_edge < big) & (gap > 0) & (gap <= SEPTUM_MAX)
    # (y, z) の面でならす（小さな穴をふさぎ、はみ出しを落とす）
    ok = ndi.binary_closing(ok, iterations=3) & ((r_edge >= 0) & (l_edge < big))
    ok = ndi.binary_opening(ok, iterations=2)
    # 前の上の、鼻中隔が厚い所（左右の空気の間が SEPTUM_MAX より広い）も、まわりが鼻中隔なら入れる
    ok = ndi.binary_fill_holes(ok) & (r_edge >= 0) & (l_edge < big)
    lab, n = ndi.label(ok)
    if n > 1:
        sizes = ndi.sum(ok, lab, index=np.arange(1, n + 1))
        ok = lab == 1 + int(np.argmax(sizes))
    # 列ごとの左右の端はならす（空気の面のぎざぎざをそのまま写さない）
    re_s = ndi.uniform_filter(np.where(ok, r_edge, 0).astype(float), 5) / np.maximum(ndi.uniform_filter(ok.astype(float), 5), 1e-6)
    le_s = ndi.uniform_filter(np.where(ok, l_edge, 0).astype(float), 5) / np.maximum(ndi.uniform_filter(ok.astype(float), 5), 1e-6)
    S = ok[None] & (xs > re_s[None]) & (xs < le_s[None]) & ~R & ~L
    # 骨と軟骨（正中のそばだけ）も入れる
    X = grid.all_points().reshape(grid.shape + (3,))
    xm = np.median(X[S][:, 0]) if S.any() else 0
    foot = ndi.binary_dilation(ok, iterations=int(2 / H))[None] & (np.abs(X[..., 0] - xm) < SEPTUM_BONE)
    for k in ("vomer", "ethmoid", "septalCartilage"):
        S |= grid.voxelize(*M[k]) & foot & ~R & ~L
    print(f"鼻中隔: {S.sum() * H ** 3:.0f}mm³、正中 x={xm:.1f}、幅の中央値 {np.median(gap[ok]):.1f}mm")
    return grid, S, R, L


def palate(M):
    P_g, F_g = M["gingiva"]
    lo = P_g.min(0) - 2
    hi = P_g.max(0) + 2
    grid = ear.Grid(lo, hi, H)
    G = grid.voxelize(P_g, F_g)
    T = grid.voxelize(*M["teeth"])
    T2 = T.any(1)  # (x, z) の面に映した歯
    # 歯列の内側: 歯の並びを囲む。いちばん後ろの大臼歯の間は後ろへ歯肉の端までのばす
    closed = ndi.binary_closing(T2, iterations=int(3 / H))
    arch = ndi.binary_fill_holes(closed)
    X = grid.all_points().reshape(grid.shape + (3,))
    xz = X[:, 0, :, :]
    tooth_pts = np.argwhere(T2)
    zt = tooth_pts[:, 1].min()  # いちばん後ろの歯の添字
    back = tooth_pts[tooth_pts[:, 1] < zt + int(4 / H)]
    xc = (lo[0] + (back[:, 0] + 0.5) * H)
    right_in = xc[xc < np.median(xc)].max() if (xc < np.median(xc)).any() else xc.min()
    left_in = xc[xc > np.median(xc)].min() if (xc > np.median(xc)).any() else xc.max()
    # 後ろの大臼歯の内側の縁の間（後ろへ）を足す。歯の内側を囲むため、左右の歯のふちの間で前の囲みに続ける
    ext = (xz[..., 0] > right_in) & (xz[..., 0] < left_in) & (np.arange(grid.shape[2])[None, :] <= zt + int(6 / H))
    inner = ndi.binary_fill_holes(arch | ext)
    # 歯そのものとそのまわりは歯肉
    away = ndi.distance_transform_edt(~T2) * H > PALATE_GAP
    region = inner & away & ~T2
    pal = G & region[:, None, :]
    # いちばん大きいかたまりだけ
    lab, n = ndi.label(pal)
    if n > 1:
        sizes = ndi.sum(pal, lab, index=np.arange(1, n + 1))
        pal = lab == 1 + int(np.argmax(sizes))
    ging = G & ~pal
    print(f"硬口蓋の粘膜: {pal.sum() * H ** 3:.0f}mm³、残りの歯肉: {ging.sum() * H ** 3:.0f}mm³（元の歯肉 {G.sum() * H ** 3:.0f}mm³）")
    return grid, pal, ging, T


def check_images(sg, S, R, L, pg, pal, ging, T):
    from PIL import Image
    pal_c = np.array([(255, 255, 255), (120, 170, 240), (90, 220, 170), (240, 160, 90)], np.uint8)
    lab = np.zeros(sg.shape, np.int8)
    lab[R] = 1
    lab[L] = 2
    lab[S] = 3
    imgs = []
    for f in (0.2, 0.35, 0.5, 0.65, 0.8):
        k = int(sg.shape[2] * f)
        imgs.append(np.pad(pal_c[lab[:, :, k]].transpose(1, 0, 2)[::-1], ((0, 3), (0, 3), (0, 0))))
    row = np.concatenate(imgs, 1)
    Image.fromarray(row).resize((row.shape[1] * 3, row.shape[0] * 3), Image.NEAREST).save(os.path.join(DIR, "check-septum-coronal.png"))
    side = pal_c[np.where(S.any(0), 3, 0)].transpose(1, 0, 2)[::-1]
    Image.fromarray(side).resize((side.shape[1] * 3, side.shape[0] * 3), Image.NEAREST).save(os.path.join(DIR, "check-septum-side.png"))
    pc = np.array([(255, 255, 255), (240, 150, 150), (200, 60, 60), (250, 250, 235)], np.uint8)
    lab = np.zeros(pg.shape, np.int8)
    lab[ging] = 1
    lab[pal] = 2
    lab[T] = 3
    below = ear.first_hit(lab[:, ::-1, :].transpose(0, 2, 1))  # 下から見る
    img = pc[below].transpose(1, 0, 2)[::-1]
    imgs = [img]
    for f in (0.3, 0.5, 0.7):
        k = int(pg.shape[2] * f)
        imgs.append(pc[lab[:, :, k]].transpose(1, 0, 2)[::-1])
    hmax = max(i.shape[0] for i in imgs)
    row = np.concatenate([np.pad(i, ((0, hmax - i.shape[0]), (0, 4), (0, 0))) for i in imgs], 1)
    Image.fromarray(row).resize((row.shape[1] * 3, row.shape[0] * 3), Image.NEAREST).save(os.path.join(DIR, "check-palate.png"))


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    M = {k: load(v) for k, v in data.items()}
    sg, S, R, L = septum(M)
    pg, pal, ging, T = palate(M)
    if CHECK:
        check_images(sg, S, R, L, pg, pal, ging, T)
    out = []

    def add(pid, name, mesh):
        if mesh is None:
            raise SystemExit(f"{name} の形ができません")
        P, F = mesh
        out.append({"id": f"PL_{pid}", "name": name, "positions": np.round(P / 1000.0, 6).ravel().tolist(), "indices": np.asarray(F).ravel().astype(int).tolist()})
        print(f"    {name}: {len(P)} 点 {len(F)} 三角形")

    add("nasal_septum", "Nasal septum", ear.mask_surface(sg, S, smooth=0.9, level=0.5, min_faces=200))
    gum = M["gingiva"]
    add("hard_palate", "Mucosa of hard palate", ear.mask_surface(pg, pal, outer=gum, smooth=0.8, level=0.5, min_faces=200, snap=0.4))
    add("gingiva_upper", "Gingiva of upper jaw", ear.mask_surface(pg, ging, outer=gum, smooth=0.8, level=0.5, min_faces=200, snap=0.4))
    json.dump({"parts": out}, open(os.path.join(DIR, "parts.json"), "w"))
    print(os.path.join(DIR, "parts.json"), len(out), "部品")


if __name__ == "__main__":
    main()
