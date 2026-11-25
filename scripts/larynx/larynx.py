# 喉頭の中のつくり（声帯ひだ・前庭ひだ・声門裂・喉頭室・声門下腔）の形を作る。
# 元の形は scripts/larynx/export.mjs が data-raw/larynx/input.json に書く（BodyParts3D の喉頭の軟骨・靱帯・膜・筋。m）。
# 使い方: python3 scripts/larynx/larynx.py [--check]（numpy と scipy だけを使う。--check は確かめる絵を data-raw/larynx/ に書く＝PIL を使う）
# 出力: data-raw/larynx/parts.json（部品ごとの形。m）。scripts/made/index.mjs が BodyParts3D の部品として読む
# （BodyParts3D の形だけから作るので CC BY 4.0 のまま、BodyParts3D の GLB に入る）。
#
# 考え方（0.2mm のボクセル）:
# - BodyParts3D には喉頭の内腔と粘膜の形が無い。内腔の壁になる形（弾性円錐・声帯靱帯・声帯筋・甲状披裂筋・披裂軟骨・披裂筋・
#   披裂喉頭蓋筋・輪状軟骨・甲状軟骨・喉頭蓋・正中輪状甲状靱帯など）を壁とし、水平断ごとに、壁を GAP だけ太らせたもの（小さなすき間をふさぐ）と
#   壁の凸包の外を仕切りとして、正中の種から塗り広げた所を内腔とする（太らせた分は壁のきわまで戻す）。
#   声帯靱帯の高さでは左右の靱帯の間の細いすき間（声門裂）だけが残り、その上で甲状披裂筋の内側まで広がる（喉頭室）。
# - 粘膜: 内腔のうち、内腔の外から MUCOSA 以内。
# - 前庭ひだ: 声帯ひだの上（声帯靱帯の高さ yV から VEST_Y の間）で、横の壁から内へ VEST_B だけ盛り上がる粘膜のひだ（前後は前交連から声帯突起の間）。
#   その下の、ひだと声帯ひだの間に外へ入りこんだ空所が喉頭室になる。
# - 声帯ひだ: yV の VF_Y の間の、前交連から声帯突起までの横の粘膜（声帯靱帯と声帯筋をおおう）。
# - 声門裂: yV の ±RIMA の空所のうち、yV の水平断で左右の声帯ひだ（と披裂軟骨）の間のすき間の所。
# - 喉頭室: 声帯ひだより上の空所のうち、真上 4mm 以内に前庭ひだがある所（左右）。
# - 声門下腔: 声門裂より下、輪状軟骨の下縁までの空所（BodyParts3D の気管は輪状軟骨の中まで入るので、下の部分は気管の形と重なる）。
import json
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ear"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kidney"))
import ear  # noqa: E402
import kidney  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "larynx")
H = 0.2
GAP = 0.4  # 壁を太らせてふさぐすき間（半分、mm）
MUCOSA = 0.5  # 粘膜の厚さ（mm）
VEST_Y = (1.4, 3.3, 5.4)  # 前庭ひだの高さ（yV から下端・いちばん盛り上がる所・上端、mm）
VEST_B = 2.3  # 前庭ひだの盛り上がり（粘膜に足す厚さ、mm）
VF_Y = (-2.6, 1.0)  # 声帯ひだの高さ（yV から、mm）
RIMA = 0.5  # 声門裂の高さの半分（mm）
TOP = 7.0  # 内腔を作る上の端（yV から、mm）
CHECK = "--check" in sys.argv
WALLS = ["thyroid", "cricoid", "epiglottis", "thyroEpi", "transverse", "cricothyroidLig", "arytenoid", "corniculate", "cuneiform", "conus",
         "vocalLig", "vocalis", "thyroAry", "lca", "oblique", "aryepi"]


def load(list_):
    Ps, Fs, o = [], [], 0
    for m in list_:
        P, F = kidney.load(m)
        Ps.append(P)
        Fs.append(F + o)
        o += len(P)
    return np.vstack(Ps), np.vstack(Fs)


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def hull_mask(mask2d):
    pts = np.argwhere(mask2d)
    if len(pts) < 4:
        return np.zeros_like(mask2d)
    hull = ConvexHull(pts)
    idx = np.indices(mask2d.shape).reshape(2, -1).T
    eq = hull.equations
    inside = (idx @ eq[:, :2].T + eq[:, 2]) <= 0.5
    return inside.all(1).reshape(mask2d.shape)


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    M = {k: load(v) for k, v in data.items()}
    group = lambda g: [k for k in M if k == g or k.startswith(g + "_")]
    # 目印
    PR, PL = M["vocalLig_r"][0], M["vocalLig_l"][0]
    x0 = (PR[:, 0].max() + PL[:, 0].min()) / 2
    yV = np.r_[PR[:, 1], PL[:, 1]].mean()
    both = np.vstack([PR, PL])
    zA, zP = both[:, 2].max(), both[:, 2].min()
    yB = M["cricoid"][0][:, 1].min() + 0.5
    print(f"正中 x={x0:.2f}、声帯靱帯の高さ y={yV:.1f}、前交連 z={zA:.1f}、声帯突起 z={zP:.1f}、輪状軟骨の下縁 y={yB:.1f}")
    P_th = M["thyroid"][0]
    lo = np.array([P_th[:, 0].min() - 1, yB - 1, P_th[:, 2].min() - 2])
    hi = np.array([P_th[:, 0].max() + 1, yV + TOP + 1, P_th[:, 2].max() + 1])
    grid = ear.Grid(lo, hi, H)
    wall = np.zeros(grid.shape, bool)
    for g in WALLS:
        for k in group(g):
            wall |= grid.voxelize(*M[k])
    jy = lambda y: int(round((y - lo[1]) / H - 0.5))
    ix0 = int(round((x0 - lo[0]) / H - 0.5))
    g = int(round(GAP / H))
    lumen = np.zeros(grid.shape, bool)
    for j in range(jy(yB), jy(yV + TOP) + 1):
        w = wall[:, j, :]
        if not w.any():
            continue
        barrier = ndi.binary_dilation(w, iterations=g) | ~hull_mask(w)
        col = ~barrier[ix0]
        runs, n = ndi.label(col)
        if not n:
            continue
        sizes = ndi.sum(col, runs, index=np.arange(1, n + 1))
        best = 1 + int(np.argmax(sizes))
        kz = np.nonzero(runs == best)[0]
        seed = kz[len(kz) // 2]
        comp, _ = ndi.label(~barrier)
        c = comp[ix0, seed]
        if c == 0:
            continue
        sl = comp == c
        # 太らせた分を壁のきわまで戻す
        for _ in range(g):
            sl = ndi.binary_dilation(sl) & ~w & hull_mask(w)
        lumen[:, j, :] = sl
    # 縦にもならす（水平断ごとのぎざぎざを減らす）
    lumen = ndi.binary_opening(lumen, structure=np.ones((1, 3, 1)))
    print(f"内腔: {lumen.sum() * H ** 3:.0f}mm³")
    # 内腔の外までの距離と、いちばん近い外の点の向き
    dist, ind = ndi.distance_transform_edt(lumen, return_indices=True)
    dist = dist * H
    X = grid.all_points().reshape(grid.shape + (3,))
    near = lo + (np.moveaxis(ind, 0, -1) + 0.5) * H
    vec = near - X
    lat = np.abs(vec[..., 0]) / (np.linalg.norm(vec, axis=-1) + 1e-9)
    Y, Z, Xx = X[..., 1] - yV, X[..., 2], X[..., 0]
    bump = smooth(Y, VEST_Y[0], VEST_Y[1]) * (1 - smooth(Y, VEST_Y[1], VEST_Y[2]))
    wz = smooth(Z, zP - 1.0, zP + 1.5) * (1 - smooth(Z, zA - 3.0, zA - 0.5))
    vest_amt = bump * wz * smooth(lat, 0.45, 0.8)
    lining = lumen & (dist <= MUCOSA + VEST_B * vest_amt)
    air = lumen & ~lining
    right = Xx < x0
    labels = np.zeros(grid.shape, np.int8)
    VF_R, VF_L, VE_R, VE_L, RIMA_L, VEN_R, VEN_L, INFRA = range(1, 9)
    vf = lining & (Y >= VF_Y[0]) & (Y <= VF_Y[1]) & (Z >= zP - 0.5) & (Z <= zA + 0.5) & (vest_amt < 0.05)
    labels[vf & right] = VF_R
    labels[vf & ~right] = VF_L
    ve = lining & (vest_amt >= 0.08) & (Y >= VEST_Y[0] - 0.4)
    labels[ve & right] = VE_R
    labels[ve & ~right] = VE_L
    jv = jy(yV)
    slit = air[:, jv, :] | lining[:, jv, :] & False
    slit = ndi.binary_dilation(air[:, jv, :], iterations=1) & lumen[:, jv, :]
    rima = air & (np.abs(Y) <= RIMA) & slit[:, None, :]
    labels[rima] = RIMA_L
    # 喉頭室: 真上 4mm 以内に前庭ひだがある空所（声門裂より上）
    above = np.zeros(grid.shape, bool)
    vmask = ve
    k4 = int(round(4.0 / H))
    for s in range(1, k4 + 1):
        above[:, :-s, :] |= vmask[:, s:, :]
    ven = air & above & (Y > RIMA) & ~rima
    labels[ven & right] = VEN_R
    labels[ven & ~right] = VEN_L
    infra = air & (Y < -RIMA)
    labels[infra] = INFRA
    names = {VF_R: ("vocal_fold_r", "Right vocal fold"), VF_L: ("vocal_fold_l", "Left vocal fold"),
             VE_R: ("vestibular_fold_r", "Right vestibular fold"), VE_L: ("vestibular_fold_l", "Left vestibular fold"),
             RIMA_L: ("rima_glottidis", "Rima glottidis"), VEN_R: ("ventricle_r", "Right laryngeal ventricle"),
             VEN_L: ("ventricle_l", "Left laryngeal ventricle"), INFRA: ("infraglottic", "Infraglottic cavity")}
    for k, (slug, name) in names.items():
        print(f"  {name}: {(labels == k).sum() * H ** 3:.1f}mm³")
    if CHECK:
        check_images(grid, wall, lumen, labels, x0, yV, zA, zP)
    out = []
    for k, (slug, name) in names.items():
        thin = k in (VF_R, VF_L)
        mesh = ear.mask_surface(grid, labels == k, smooth=0.6 if thin else 0.8, level=0.45 if thin else 0.5, min_faces=60)
        if mesh is None:
            raise SystemExit(f"{name} の形ができません")
        P, F = mesh
        out.append({"id": f"LX_{slug}", "name": name, "positions": np.round(P / 1000.0, 6).ravel().tolist(), "indices": np.asarray(F).ravel().astype(int).tolist()})
        print(f"    {name}: {len(P)} 点 {len(F)} 三角形")
    json.dump({"parts": out}, open(os.path.join(DIR, "parts.json"), "w"))
    print(os.path.join(DIR, "parts.json"), len(out), "部品")


def check_images(grid, wall, lumen, labels, x0, yV, zA, zP):
    from PIL import Image
    pal = np.array([(255, 255, 255), (245, 240, 225), (245, 240, 225), (225, 130, 130), (225, 130, 130), (40, 60, 220), (90, 200, 120), (90, 200, 120),
                    (120, 190, 240), (210, 210, 210), (180, 225, 250)], np.uint8)
    L = labels.copy()
    L[(L == 0) & lumen] = 10  # 名前の無い粘膜と内腔（喉頭前庭など）
    L[(L == 0) & wall] = 9
    lo = grid.lo
    rows = []
    for zs in ((zA - 2, zA - 5, (zA + zP) / 2, zP + 3), ):
        imgs = []
        for z in zs:
            k = int((z - lo[2]) / H)
            imgs.append(np.pad(pal[L[:, :, k]].transpose(1, 0, 2)[::-1], ((0, 3), (0, 3), (0, 0))))
        rows.append(np.concatenate(imgs, 1))
    imgs = []
    for y in (yV - 3, yV - 0.2, yV + 1.0, yV + 2.0, yV + 3.3, yV + 5):
        k = int((y - lo[1]) / H)
        imgs.append(np.pad(pal[L[:, k, :]].transpose(1, 0, 2)[::-1], ((0, 3), (0, 3), (0, 0))))
    rows.append(np.concatenate(imgs, 1))
    k = int((x0 - 3 - lo[0]) / H)
    rows.append(pal[L[k]].transpose(1, 0, 2)[::-1][:, ::-1])
    for i, r in enumerate(rows):
        Image.fromarray(r).resize((r.shape[1] * 3, r.shape[0] * 3), Image.NEAREST).save(os.path.join(DIR, f"check-{['coronal', 'horizontal', 'sagittal'][i]}.png"))


if __name__ == "__main__":
    main()
