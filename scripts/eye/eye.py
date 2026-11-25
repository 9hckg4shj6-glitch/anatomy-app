# 眼球の中のつくり（瞳孔・後眼房・黄斑・中心窩・視神経円板）の形を作る。
# 元の形は scripts/eye/export.mjs が data-raw/eye/input.json に書く（BodyParts3D の眼球の部品と視神経。m）。
# 使い方: python3 scripts/eye/eye.py [--check]（numpy と scipy だけを使う。--check は確かめる絵を data-raw/eye/ に書く＝PIL を使う）
# 出力: data-raw/eye/parts.json（部品ごとの形。m）。scripts/made/index.mjs が BodyParts3D の部品として読む
# （BodyParts3D の形だけから作るので CC BY 4.0 のまま、BodyParts3D の GLB に入る）。
#
# 考え方（左右の眼をそれぞれ同じ手順で作る。耳側＝外側は眼の中心の x の符号の向き）:
# - 眼の軸: 眼球の中心（強膜の外接箱の中心）から角膜の中心への向き。
# - 瞳孔: 虹彩の点の軸からの距離のいちばん小さい値が瞳孔の半径。瞳孔のふちの虹彩の厚さの間に、穴をふさぐ円板を置く（強調したときだけ描く）。
# - 後眼房: 眼球の中（強膜の内側）で、どの部品にも入らない空所のうち、虹彩の後ろ・水晶体と毛様体小帯の前のもの（0.1mm のボクセル）。
#   瞳孔の円柱と前眼房のまわりのすき間は除く。
# - 視神経円板: 視神経のうち強膜の外 6mm までの点の中心の向きで、網膜の内面に当たる所。縦長の楕円（横 1.6・縦 1.8mm）の板で、
#   ふちが少し盛り上がり、真ん中がくぼむ（生理的陥凹）。
# - 黄斑・中心窩: 眼の軸の後ろの極から、網膜の内面の上を耳側へ FOVEA_TEMPORAL、下へ FOVEA_DOWN の所が中心窩の中心
#   （BodyParts3D の視神経は後ろの極の約 1.5mm 鼻側・2.3mm 上で入る。円板から耳側へ測ると中心窩が上へずれるので、中心窩は眼の軸から決める。円板との間は約 3.6mm）。黄斑はそのまわりの円い板で、
#   ふちから中心へ高まってから中心窩へ落ちこむ（中心窩は黄斑のくぼみの底の小さな板）。
#   板はどれも網膜の内面から硝子体の側へ少しだけ出し（網膜の面と重ならないように）、裏は網膜の中に沈める。
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
DIR = os.path.join(ROOT, "data-raw", "eye")
H = 0.1  # 後眼房のボクセル（mm）
DISC = (0.8, 0.9)  # 視神経円板の半径（横・縦、mm）
FOVEA_TEMPORAL = 1.2  # 中心窩の中心: 眼の軸の後ろの極から網膜の上を耳側へ（mm。見る軸は眼の軸より約5°耳側を通る）
FOVEA_DOWN = 0.3  # 同じく下へ（mm）
MACULA_R = 1.3  # 黄斑の半径（mm）
FOVEA_R = 0.55  # 中心窩の板の半径（mm）
SINK = 0.15  # 板の裏を網膜の内面から沈める深さ（mm）
CHECK = "--check" in sys.argv


def load(list_):
    Ps, Fs, o = [], [], 0
    for m in list_:
        P, F = kidney.load(m)
        Ps.append(P)
        Fs.append(F + o)
        o += len(P)
    return np.vstack(Ps), np.vstack(Fs)


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


def ray_hits(P, F, origin, dirs):
    """origin から dirs の向きへの光線が、形に最初に当たる距離（当たらなければ inf）。Möller–Trumbore"""
    A, B, C = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    e1, e2 = B - A, C - A
    out = np.full(len(dirs), np.inf)
    for s in range(0, len(dirs), 64):
        D = dirs[s:s + 64][:, None, :]
        pv = np.cross(D, e2[None])
        det = (e1[None] * pv).sum(-1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
        tv = origin - A
        u = (tv[None] * pv).sum(-1) * inv
        qv = np.cross(tv[None], e1[None])
        v = (D * qv).sum(-1) * inv
        t = (e2[None] * qv).sum(-1) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
        out[s:s + 64] = np.where(hit, t, np.inf).min(1)
    return out


class Retina:
    """網膜の内面（眼球の中心から外へ向かう光線が最初に当たる面）"""

    def __init__(self, P, F, center):
        self.P, self.F, self.c = P, F, center

    def at(self, dirs):
        dirs = unit(dirs)
        t = ray_hits(self.P, self.F, self.c, dirs)
        if not np.isfinite(t).all():
            raise SystemExit("網膜に当たらない向きがあります")
        q = self.c + dirs * t[:, None]
        return q, -dirs  # 面の点と、内向き（眼球の中心の向き）の法線

    def walk(self, start_dir, toward, dist, steps=40):
        """start_dir の点から、網膜の上を toward（向き）へ dist（mm）進んだ点の向き"""
        d = unit(start_dir)
        for _ in range(steps):
            q, n = self.at(d[None])
            tang = unit(toward - (toward @ -n[0]) * -n[0])
            d = unit(q[0] + tang * dist / steps - self.c)
        return d


def patch(ret, center_dir, up, radius, top, bottom, nr=14, nt=64):
    """網膜の内面に貼る板の閉じた形。center_dir の点のまわりに、接平面の上で (r, θ) をとる。
    radius(θ) は板の半径（mm）、top(ρ)・bottom(ρ) は内面からの高さ（mm、硝子体の側が正。ρ はふちを1とした半径）"""
    q0, n0 = ret.at(unit(center_dir)[None])
    q0, n0 = q0[0], n0[0]
    e2 = unit(up - (up @ n0) * n0)
    e1 = np.cross(e2, n0)
    th = np.linspace(0, 2 * np.pi, nt, endpoint=False)
    rho = np.linspace(0, 1, nr + 1)[1:]
    R = np.array([radius(t) for t in th])
    pts = [q0]
    for r in rho:
        pts.extend(q0 + (np.cos(th)[:, None] * e1[None] + np.sin(th)[:, None] * e2[None]) * (r * R)[:, None])
    pts = np.array(pts)
    q, n = ret.at(pts - ret.c)
    rr = np.r_[0, np.repeat(rho, nt)]
    Vt = q + n * np.array([top(r) for r in rr])[:, None]
    Vb = q + n * np.array([bottom(r) for r in rr])[:, None]
    N = len(q)
    faces = []
    for k in range(nt):  # 真ん中の扇
        faces.append((0, 1 + k, 1 + (k + 1) % nt))
    for i in range(nr - 1):
        a, b = 1 + i * nt, 1 + (i + 1) * nt
        for k in range(nt):
            k2 = (k + 1) % nt
            faces.append((a + k, b + k, b + k2))
            faces.append((a + k, b + k2, a + k2))
    faces = np.array(faces)
    # 上の面は硝子体の側（法線が n の向き）を表に、下の面は裏返す。ふちは上と下をつなぐ
    top_f = faces
    bot_f = faces[:, ::-1] + N
    rim = []
    a = 1 + (nr - 1) * nt
    for k in range(nt):
        k2 = (k + 1) % nt
        rim.append((a + k, a + k + N, a + k2 + N))
        rim.append((a + k, a + k2 + N, a + k2))
    F = np.vstack([top_f, bot_f, np.array(rim)])
    V = np.vstack([Vt, Vb])
    # 向きをそろえる（体積が正になるように）
    vol = np.einsum("ij,ij->i", V[F[:, 0]], np.cross(V[F[:, 1]], V[F[:, 2]])).sum()
    if vol < 0:
        F = F[:, ::-1]
    return V, F, q0, n0


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def disc_mesh(P_out, F_out, center, axis, r, t0, t1, n=64):
    """軸 axis のまわりの円板（半径 r、軸の上の位置 t0〜t1）"""
    e1 = unit(np.cross(axis, [0, 1, 0]))
    e2 = np.cross(axis, e1)
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ring = (np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2) * r
    V = np.vstack([center + axis * t0, center + axis * t1, center + axis * t0 + ring, center + axis * t1 + ring])
    F = []
    for k in range(n):
        k2 = (k + 1) % n
        F.append((0, 2 + k2, 2 + k))
        F.append((1, 2 + n + k, 2 + n + k2))
        F.append((2 + k, 2 + k2, 2 + n + k2))
        F.append((2 + k, 2 + n + k2, 2 + n + k))
    return V, np.array(F)


def build(side, d):
    M = {k: load(v) for k, v in d.items()}
    P_scl = M["sclera"][0]
    C = (P_scl.min(0) + P_scl.max(0)) / 2
    corn = M["cornea"][0]
    axis = unit((corn.min(0) + corn.max(0)) / 2 - C)
    temporal = np.array([np.sign(C[0]), 0, 0.0])
    up = np.array([0, 1.0, 0])
    print(f"{side}: 眼球の中心 {C.round(1)}、軸 {axis.round(3)}")
    ret = Retina(*M["retina"], C)
    parts = []

    # ---- 瞳孔
    Pi = M["iris"][0]
    ci = Pi.mean(0)
    rel = Pi - ci
    t = rel @ axis
    radial = np.linalg.norm(rel - t[:, None] * axis, axis=1)
    r_pupil = radial.min()
    margin = radial < r_pupil + 0.3
    t0, t1 = t[margin].min(), t[margin].max()
    mid = (t0 + t1) / 2
    half = max(0.12, (t1 - t0) / 2 - 0.08)
    V, F = disc_mesh(None, None, ci, axis, r_pupil + 0.08, mid - half, mid + half)
    parts.append(("pupil", "pupil", V, F))
    print(f"  瞳孔: 半径 {r_pupil:.2f}mm、虹彩のふちの厚さ {t1 - t0:.2f}mm")

    # ---- 視神経円板
    P_on, _ = M["optic"]
    dist = np.linalg.norm(P_on - C, axis=1)
    R_out = np.linalg.norm(P_scl - C, axis=1).max()
    near = (dist > R_out - 1.5) & (dist < R_out + 6)
    # 視神経の形は2つ（同じ名前）あるので、眼球の後ろの点が多い方の点を使う
    disc_dir = unit(P_on[near].mean(0) - C)
    disc_r = lambda th: DISC[0] * DISC[1] / np.hypot(DISC[1] * np.cos(th), DISC[0] * np.sin(th))
    V, F, q_disc, n_disc = patch(
        ret, disc_dir, up, disc_r,
        top=lambda r: 0.05 + 0.22 * smooth(r, 0.35, 0.7) * (1 - smooth(r, 0.75, 1.0)) + 0.0 * r,
        bottom=lambda r: -SINK - 0.15)
    parts.append(("optic_disc", "optic disc", V, F))
    ang = np.degrees(np.arccos(np.clip(disc_dir @ -axis, -1, 1)))
    print(f"  視神経円板: {q_disc.round(1)}（眼の軸の後ろの極から {ang:.1f}°、鼻側か: {(q_disc - C)[0] * temporal[0] < 0}）")

    # ---- 中心窩と黄斑
    d1 = ret.walk(-axis, temporal, FOVEA_TEMPORAL, steps=10)
    fov_dir = ret.walk(d1, -up, FOVEA_DOWN, steps=10)
    q_f, _ = ret.at(fov_dir[None])
    ang = np.degrees(np.arccos(np.clip(fov_dir @ -axis, -1, 1)))
    print(f"  中心窩: {q_f[0].round(1)}（眼の軸の後ろの極から {ang:.1f}°、円板の中心から {np.linalg.norm(q_f[0] - q_disc):.2f}mm）")
    rin = 0.35 / MACULA_R
    V, F, _, _ = patch(
        ret, fov_dir, up, lambda th: MACULA_R,
        top=lambda r: 0.02 + 0.2 * smooth(r, rin, 0.62) - 0.15 * smooth(r, 0.65, 1.0),
        bottom=lambda r: -SINK)
    parts.append(("macula", "macula lutea", V, F))
    V, F, _, _ = patch(
        ret, fov_dir, up, lambda th: FOVEA_R,
        top=lambda r: 0.075 - 0.04 * smooth(r, 0.8, 1.0),
        bottom=lambda r: -SINK + 0.02, nr=8, nt=48)
    parts.append(("fovea", "fovea centralis", V, F))

    # ---- 後眼房
    P_all = np.vstack([M[k][0] for k in M if k != "optic"])
    lo, hi = P_all.min(0) - 0.5, P_all.max(0) + 0.5
    lo[1:] = np.minimum(lo[1:], P_scl.min(0)[1:] - 0.5)
    grid = ear.Grid(lo, hi, H)
    order = ["sclera", "choroid", "retina", "vitreous", "ciliary", "zonule", "lens", "iris", "anterior", "cornea"]
    lab = np.zeros(grid.shape, np.int8)
    for i, k in enumerate(order, 1):
        lab[grid.voxelize(*M[k])] = i
    L = {k: i for i, k in enumerate(order, 1)}
    inside = ndi.binary_fill_holes(lab > 0)
    free = inside & (lab == 0)
    X = grid.all_points().reshape(grid.shape + (3,))
    ta = (X - C) @ axis
    rad = np.linalg.norm((X - C) - ta[..., None] * axis, axis=-1)
    # 毛様体小帯のいちばん後ろより前、虹彩のいちばん前より後ろ
    zon_t = (M["zonule"][0] - C) @ axis
    iris_t = (Pi - C) @ axis
    band = (ta >= zon_t.min()) & (ta <= iris_t.max())
    cand = free & band
    # 瞳孔の円柱（虹彩のふちの厚さの間）と、前眼房のまわり 0.25mm は除く
    pupil_cyl = (rad < r_pupil + 0.1) & (ta >= (ci - C) @ axis + t0 - 0.05)
    near_ant = ndi.binary_dilation(lab == L["anterior"], iterations=3)
    cand &= ~pupil_cyl & ~near_ant
    comp, k = ndi.label(cand)
    # 虹彩の後ろの面と水晶体（または小帯）の両方に接するかたまり
    touch_iris = ndi.binary_dilation(lab == L["iris"], iterations=2)
    touch_lens = ndi.binary_dilation((lab == L["lens"]) | (lab == L["zonule"]), iterations=2)
    keep = np.zeros(k + 1, bool)
    sizes = ndi.sum(np.ones_like(comp), comp, index=np.arange(k + 1))
    for c in range(1, k + 1):
        m = comp == c
        if sizes[c] > 200 and (m & touch_iris).any() and (m & touch_lens).any():
            keep[c] = True
    post = keep[comp]
    post = ndi.binary_closing(post, iterations=1) & ~(lab > 0) | post
    vol = post.sum() * H ** 3
    print(f"  後眼房: {vol:.1f}mm³（{keep.sum()} かたまり）")
    mesh = ear.mask_surface(grid, post, smooth=0.6, level=0.5, min_faces=200)
    if mesh is None:
        raise SystemExit("後眼房の形ができません")
    parts.append(("posterior_chamber", "posterior chamber of eyeball", *mesh))
    if CHECK:
        check_images(side, grid, lab, post, C, axis)
    return parts


def check_images(side, grid, lab, post, C, axis):
    from PIL import Image
    pal = np.array([(255, 255, 255), (230, 230, 220), (120, 60, 50), (230, 140, 110), (200, 220, 240), (150, 90, 60), (240, 200, 80),
                    (250, 230, 150), (60, 90, 160), (150, 220, 250), (180, 240, 200), (240, 40, 40)], np.uint8)
    L = lab.copy()
    L[post] = 11
    cx = int((C[0] - grid.lo[0]) / H)
    cy = int((C[1] - grid.lo[1]) / H)
    imgs = [pal[L[cx]].transpose(1, 0, 2)[::-1], pal[L[:, cy]].transpose(1, 0, 2)[::-1]]
    hmax = max(i.shape[0] for i in imgs)
    row = np.concatenate([np.pad(i, ((0, hmax - i.shape[0]), (0, 6), (0, 0))) for i in imgs], 1)
    Image.fromarray(row).resize((row.shape[1] * 3, row.shape[0] * 3), Image.NEAREST).save(os.path.join(DIR, f"check-{side}-sections.png"))


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    out = []
    for side in ("right", "left"):
        for slug, name, V, F in build(side, data[side]):
            P = np.asarray(V, dtype=np.float64)
            out.append({"id": f"EY_{slug}_{side[0]}", "name": f"{side.capitalize()} {name}",
                        "positions": np.round(P / 1000.0, 6).ravel().tolist(), "indices": np.asarray(F).ravel().astype(int).tolist()})
            print(f"    {name}: {len(P)} 点 {len(F)} 三角形")
    json.dump({"parts": out}, open(os.path.join(DIR, "parts.json"), "w"))
    print(os.path.join(DIR, "parts.json"), len(out), "部品")


if __name__ == "__main__":
    main()
