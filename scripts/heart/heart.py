# 心臓の中のつくりの形を作る（心室中隔・心房中隔・自由壁・動脈円錐・卵円窩・肉柱・中隔縁柱・櫛状筋と分界稜・腱索・
# 刺激伝導系・線維輪・心膜・心内膜）。
# 元の形は scripts/heart/export.mjs が data-raw/heart/input.json に書く（BodyParts3D の心臓の壁・内腔・弁・乳頭筋と大血管。m）。
# 使い方: python3 scripts/heart/heart.py [--check]（numpy と scipy だけを使う。--check は確かめる断面の画像を data-raw/heart/ に書く＝PIL を使う）
# 出力: data-raw/heart/parts.json（部品ごとの形。m）。scripts/heart/index.mjs が BodyParts3D の部品として読む
# （BodyParts3D の形だけから作るので CC BY 4.0 のまま。build-models の BodyParts3D の GLB に入る）。
#
# 考え方:
# - 心筋（壁）は 0.5mm のボクセルで作り直す。BodyParts3D の心室の壁（右と左を合わせると閉じた形）・右心房の壁・左心房の壁の中が心筋。
#   それぞれのボクセルが、どの内腔（BodyParts3D の内腔の形）にどれだけ近いかで分ける:
#   - 心室中隔: 左心室の内腔からも右心室の内腔からも SEPTUM_V 以内（左右の内腔にはさまれた壁）。
#   - 動脈円錐: 右心室の壁のうち、肺動脈弁の中心から CONUS 以内で、三尖弁より上（流出路）。
#   - 心房中隔: 右心房と左心房の内腔からともに SEPTUM_A 以内。卵円窩はその右心房側の面の楕円のくぼみ（底の薄い膜が卵円窩の部品）。
# - 肉柱: 心室の内面（内腔の中で壁から少し離れた等値面）に沿って、心尖から心底へ向かう道を乱数で引き、半分ほど壁に埋まる太さで
#   ボクセルに描く（右心室は粗く太く、左心室は細かく密に。心底に近い流出路と、乳頭筋・腱索のまわりには作らない）。
#   中隔縁柱は右心室の中隔の中ほどから前乳頭筋の根もとへ、内腔を横切る太い柱。櫛状筋は右心耳の内面の平行な隆起、分界稜はその根もとの縦の隆起（右心房の壁の一部）。
# - 面は surface nets で作り Taubin 法でならし、元の壁の面（心外膜と心内膜の面）から SNAP 以内の点は元の面へ吸い付ける。
# - 腱索: BodyParts3D の房室弁の尖には腱索が一緒に入っているので、点のまわりの形がひも状（主成分の1つめが大きい）か膜状かで分ける。
# - 刺激伝導系・線維輪: 道すじ（点の並び）を決め、その上に管の形を直接作る（ボクセルより細くできる）。
# - 心膜: 心臓と出入りする大血管の根もとからの距離の場の等値面（心外膜・心膜腔・漿膜性心膜の壁側板・線維性心膜の層）。心内膜は内腔の面のすぐ内側の薄い殻。
import json
import os
import sys

import numpy as np
import scipy.sparse as sp
from scipy import ndimage as ndi
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "nasal"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "kidney"))
from nasalseg import surface_nets, taubin  # noqa: E402
import kidney  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIR = os.path.join(ROOT, "data-raw", "heart")
H = 0.5  # ボクセルの大きさ（mm）
kidney.H = H
PAD = 9.0  # 形のまわりの余白（mm。心膜の層が入るように）
SEPTUM_V = 13.0  # 心室中隔（左右の心室の内腔からともにこの距離以内、mm）
SEPTUM_A = 7.0  # 心房中隔（左右の心房の内腔からともにこの距離以内、mm）
CONUS = 24.0  # 動脈円錐（肺動脈弁の中心からの距離、mm）
SAC_CLOSE = 7.0  # 心膜の袋を閉じる広さ（mm）
SURFACE = 2.0  # 中隔を心臓の表面から離す距離（mm）
GROW = 3.0  # 内腔を壁の内面まで広げる距離（mm）
SNAP = 0.9  # 元の壁の面へ吸い付ける距離（mm）
LEVEL = 0.5
SMOOTH = 0.7  # 面を取る前にボクセルをぼかす広さ（ボクセル）
CHECK = "--check" in sys.argv
RNG = np.random.default_rng(20261116)


def load(m):
    return kidney.load(m)


def merge(*meshes):
    """いくつかの形を1つに（同じ位置の点はまとめる）"""
    Ps, Fs, o = [], [], 0
    for P, F in meshes:
        Ps.append(P)
        Fs.append(F + o)
        o += len(P)
    P, F = np.vstack(Ps), np.vstack(Fs)
    key = np.round(P / 1e-3).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    F = inv.ravel()[F]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return P[first], F


class Grid:
    def __init__(self, lo, hi):
        self.lo = lo
        self.shape = tuple(np.ceil((hi - lo) / H).astype(int) + 1)
        self.axes = [lo[k] + (np.arange(self.shape[k]) + 0.5) * H for k in range(3)]

    def voxelize(self, P, F):
        return kidney.voxelize(P, F, self.lo, self.shape)

    def coords(self, mask=None):
        """ボクセルの中心（mm）。mask を渡すとその中だけ"""
        idx = np.argwhere(mask) if mask is not None else None
        return self.lo + (idx + 0.5) * H, idx

    def index(self, p):
        return np.clip(np.floor((np.asarray(p) - self.lo) / H).astype(int), 0, np.array(self.shape) - 1)

    def dist(self, mask):
        """mask からの距離（mm。mask の中は 0）"""
        return (ndi.distance_transform_edt(~mask) * H).astype(np.float32)

    def sample(self, field, p):
        """field を点 p（mm、[N,3]）で3次元の線形補間"""
        g = (np.atleast_2d(p) - self.lo) / H - 0.5
        return ndi.map_coordinates(field, g.T, order=1, mode="nearest")


def between(mask, near, keys, solid):
    """mask のボクセルのうち、keys の2つの内腔のいちばん近い点まで、心臓の中（solid）を出ずにまっすぐ行けるもの
    （左心室の前の壁は前室間溝をはさんで右心室に近いが、間に心臓の外の溝があるので中隔ではない）"""
    idx = np.argwhere(mask)
    if not len(idx):
        return mask
    ok = np.ones(len(idx), dtype=bool)
    for k in keys:
        target = near[k][(slice(None),) + tuple(idx.T)].T.astype(np.float64)
        for t in np.linspace(0.1, 0.9, 9):
            q = np.round(idx + (target - idx) * t).astype(int)
            ok &= solid[tuple(q.T)]
    out = np.zeros_like(mask)
    out[tuple(idx[ok].T)] = True
    return out


def segment_walls(grid, data):
    """心筋のボクセルを分ける。返り値 dict（ラベルの配列・内腔・距離の場）"""
    vent = merge(load(data["wallLV"]), load(data["wallRV"]))
    myoV = grid.voxelize(*vent)
    myoRA = grid.voxelize(*merge(load(data["wallRA"])))
    myoLA = grid.voxelize(*merge(load(data["wallLA"])))
    cav = {k: grid.voxelize(*merge(load(data[k]))) for k in ("cavLV", "cavRV", "cavRA", "cavLA")}
    myo = myoV | myoRA | myoLA
    for k in cav:
        cav[k] &= ~myo
    # BodyParts3D の内腔（4.0 の粗い形）と壁の内面の間には 1〜4mm のすき間がある所があるので、心筋を越えずに GROW まで広げる
    # （広げた所が重なれば、元の内腔に近いほうにする）
    grown = {k: ndi.binary_dilation(v, iterations=int(GROW / H), mask=~myo) for k, v in cav.items()}
    d0 = {k: ndi.distance_transform_edt(~v) for k, v in cav.items()}
    for k in cav:
        mine = grown[k].copy()
        for j in cav:
            if j != k:
                mine &= ~(grown[j] & (d0[j] < d0[k]))
        cav[k] = mine
    del grown, d0
    dist, near = {}, {}
    for k, v in cav.items():
        d, ind = ndi.distance_transform_edt(~v, return_indices=True)
        dist[k] = (d * H).astype(np.float32)
        near[k] = ind.astype(np.int16)
    print("心筋のボクセル", int(myoV.sum()), int(myoRA.sum()), int(myoLA.sum()), "内腔", {k: int(v.sum()) for k, v in cav.items()})
    labels = np.zeros(grid.shape, dtype=np.uint8)
    # 心室: 近い内腔の側の自由壁、両方に近ければ中隔
    labels[myoV & (dist["cavLV"] <= dist["cavRV"])] = LV
    labels[myoV & (dist["cavLV"] > dist["cavRV"])] = RV
    solid = myo | cav["cavLV"] | cav["cavRV"] | cav["cavRA"] | cav["cavLA"]
    # 中隔は心臓の表面（前室間溝・後室間溝）には SURFACE より近づけない（表面は自由壁のもの）
    outside = grid.dist(~ndi.binary_closing(solid, structure=kidney.ball(2.0)))
    labels[between(myoV & (dist["cavLV"] <= SEPTUM_V) & (dist["cavRV"] <= SEPTUM_V) & (outside > SURFACE), near, ("cavLV", "cavRV"), solid)] = IVS
    # 動脈円錐: 肺動脈弁の中心から CONUS 以内で、三尖弁の尖の上端より上
    pv = np.vstack([load(v)[0] for v in data["vessels"] if "pulmonary valve" in v["name"].lower()])
    pv_center = pv.mean(0)
    tric_top = max(load(data[k])[0][:, 1].max() for k in ("tricA", "tricP", "tricS"))
    X, idx = grid.coords(labels == RV)
    outflow = (np.linalg.norm(X - pv_center, axis=1) <= CONUS) & (X[:, 1] > tric_top - 14.0)
    labels[tuple(idx[outflow].T)] = CONUS_L
    # 心房: 右心房の壁と左心房の壁は別の形。両方の内腔に近い所が中隔
    labels[myoRA & (labels == 0)] = RA
    labels[myoLA & (labels == 0)] = LA
    # 右心房と左心房の壁は別の形で、中隔では間に細いすき間があるので、閉じてから見る
    closed = ndi.binary_closing(solid, structure=kidney.ball(2.0))
    sept = between((myoRA | myoLA) & (dist["cavRA"] <= SEPTUM_A) & (dist["cavLA"] <= SEPTUM_A) & (outside > SURFACE), near, ("cavRA", "cavLA"), closed)
    labels[sept] = IAS
    for k, v in zip(("LV", "RV", "IVS", "CONUS", "RA", "LA", "IAS"), (LV, RV, IVS, CONUS_L, RA, LA, IAS)):
        print(f"  {k}: {(labels == v).sum() * H ** 3 / 1000:.1f} mL")
    return {"labels": labels, "cav": cav, "dist": dist, "myoV": myoV, "myoA": myoRA | myoLA, "pv_center": pv_center}


# ボクセルのラベル
LV, RV, IVS, CONUS_L, RA, LA, IAS, FOSSA, TRAB_LV, TRAB_RV, MODERATOR, PECTINATE, CRISTA = range(1, 14)
COLORS = {
    LV: (200, 70, 90), RV: (80, 120, 200), IVS: (230, 170, 60), CONUS_L: (120, 180, 220), RA: (150, 180, 230), LA: (235, 160, 175),
    IAS: (240, 210, 90), FOSSA: (250, 240, 160), TRAB_LV: (130, 30, 50), TRAB_RV: (30, 60, 140), MODERATOR: (40, 160, 90), PECTINATE: (90, 110, 170), CRISTA: (60, 70, 140),
}


CONDUCTION_NAMES = {
    "san": "Sinuatrial node", "avn": "Atrioventricular node", "his": "Atrioventricular bundle",
    "rbb": "Right bundle branch", "lbb": "Left bundle branch", "purkinje": "Subendocardial branches",
}
SHELL_NAMES = {
    "epicardium": "Epicardium", "pericardial_cavity": "Pericardial cavity", "serous_parietal": "Parietal layer of serous pericardium",
    "fibrous_pericardium": "Fibrous pericardium", "endocardium": "Endocardium",
}
# 壁と内面のつくりの部品: (ID の末尾, 名前, ラベル, 元の壁の面へ吸い付けるか)
WALL_PARTS = [
    ("lv", "Wall of left ventricle", [LV], True),
    ("rv", "Wall of right ventricle", [RV], True),
    ("ivs", "Interventricular septum", [IVS], True),
    ("conus", "Conus arteriosus", [CONUS_L], True),
    ("ra", "Wall of right atrium", [RA], True),
    ("la", "Wall of left atrium", [LA], True),
    ("ias", "Interatrial septum", [IAS], True),
    ("fossa", "Fossa ovalis", [FOSSA], False),
    ("trab_lv", "Trabeculae carneae of left ventricle", [TRAB_LV], False),
    ("trab_rv", "Trabeculae carneae of right ventricle", [TRAB_RV], False),
    ("moderator", "Septomarginal trabecula", [MODERATOR], False),
    ("pectinate", "Pectinate muscles", [PECTINATE], False),
    ("crista", "Crista terminalis", [CRISTA], False),
]


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / max(np.linalg.norm(v), 1e-12)


class Walker:
    """内腔の中の「壁からの距離」の場 D に沿って、壁の内面を這う道を引く"""

    def __init__(self, grid, D, ok):
        self.grid, self.D, self.ok = grid, D, ok  # ok(p) → 続けてよいか

    def depth(self, p):
        return float(self.grid.sample(self.D, p)[0])

    def normal(self, p):
        e = 0.5
        g = np.array([self.depth(p + e * np.eye(3)[k]) - self.depth(p - e * np.eye(3)[k]) for k in range(3)])
        return unit(g)  # 壁から内腔の奥へ

    def settle(self, p, target):
        for _ in range(4):
            n = self.normal(p)
            p = p - (self.depth(p) - target) * n
        return p

    def walk(self, p, d, length, target, step=0.5, wiggle=0.12, bend=None):
        """p から d の向きへ length mm。target は壁からの高さ（mm）。bend(p, d) は向きを曲げる力（無ければまっすぐ＋ゆらぎ）"""
        p = self.settle(np.asarray(p, dtype=np.float64), target)
        pts = [p]
        for _ in range(int(length / step)):
            n = self.normal(p)
            if bend is not None:
                d = d + bend(p, d)
            d = d + RNG.normal(0, wiggle, 3)
            d = unit(d - np.dot(d, n) * n)
            q = self.settle(p + step * d, target)
            if not self.ok(q) or np.linalg.norm(q - p) > 3 * step:
                break
            pts.append(q)
            p = q
        return np.array(pts)


def paint(grid, labels, path, radius, label, allowed):
    """道（点の並び）のまわり radius（mm。点ごとの配列でもよい）以内で、allowed のボクセルに label を塗る"""
    path = np.asarray(path)
    if len(path) < 2:
        return
    radius = np.broadcast_to(np.asarray(radius, dtype=np.float64), (len(path),))
    for i in range(len(path) - 1):
        a, b, ra, rb = path[i], path[i + 1], radius[i], radius[i + 1]
        r = max(ra, rb)
        lo = grid.index(np.minimum(a, b) - r - H)
        hi = grid.index(np.maximum(a, b) + r + H) + 1
        sl = tuple(slice(lo[k], hi[k]) for k in range(3))
        X = np.stack(np.meshgrid(*[grid.axes[k][sl[k]] for k in range(3)], indexing="ij"), -1)
        ab = b - a
        t = np.clip(((X - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        dist = np.linalg.norm(X - (a + t[..., None] * ab), axis=-1)
        hit = (dist <= ra + t * (rb - ra)) & allowed[sl]
        labels[sl][hit] = label


def point_mask(grid, P):
    m = np.zeros(grid.shape, dtype=bool)
    m[tuple(grid.index(P).T)] = True
    return m


def axis_of(cavity_pts, base):
    """心室の長軸。base（心底の中心）から内腔のいちばん遠い点（心尖）へ"""
    far = cavity_pts[np.argmax(np.linalg.norm(cavity_pts - base, axis=1))]
    return far, unit(far - base), np.linalg.norm(far - base)


def interior(grid, data, seg):
    """壁の内面のつくり（肉柱・中隔縁柱・櫛状筋・分界稜）と卵円窩をラベルに足す"""
    labels, cav, dist = seg["labels"], seg["cav"], seg["dist"]
    myo = labels > 0
    D = grid.dist(myo)  # 内腔の中の、心筋からの距離
    valve_pts = np.vstack([load(data[k])[0] for k in ("papRVant", "papRVpost", "papRVsep", "papLVant", "papLVpost", "mitralA", "mitralP", "tricA", "tricP", "tricS")])
    dvalve = grid.dist(point_mask(grid, valve_pts))
    free = lambda: (labels == 0)
    out = {}

    for side, cavkey, leaflets, lab, n_cords, r_rng, len_rng, tmin in (
        ("LV", "cavLV", ("mitralA", "mitralP"), TRAB_LV, 150, (0.6, 1.1), (6, 16), 0.36),
        ("RV", "cavRV", ("tricA", "tricP", "tricS"), TRAB_RV, 130, (1.0, 1.8), (12, 28), 0.3),
    ):
        base = np.vstack([load(data[k])[0] for k in leaflets]).mean(0)
        Pc, _ = grid.coords(cav[cavkey])
        apex, ax, L = axis_of(Pc, base)
        out[side] = (base, apex, ax, L)
        tpos = lambda p: np.dot(p - base, ax) / L

        def ok(p, cavkey=cavkey, tpos=tpos, tmin=tmin):
            i = tuple(grid.index(p))
            return cav[cavkey][i] and tpos(p) >= tmin and dvalve[i] > 2.0 and (side != "RV" or np.linalg.norm(p - seg["pv_center"]) > 30)

        walker = Walker(grid, D, ok)
        seeds_mask = cav[cavkey] & (D > 0.4) & (D < 1.2) & (dvalve > 3.0)
        S, _ = grid.coords(seeds_mask)
        S = S[np.array([tpos(p) >= tmin for p in S])]
        if side == "RV":
            S = S[np.linalg.norm(S - seg["pv_center"], axis=1) > 30]
        count = 0
        for p in S[RNG.choice(len(S), size=min(n_cords * 8, len(S)), replace=False)]:
            r = RNG.uniform(*r_rng)
            # 心尖のほうほど向きがばらばら（網目）、心底に近いほど長軸にそろう
            d = ax * RNG.choice([-1, 1]) + RNG.normal(0, 0.6 + 0.6 * tpos(p), 3)
            path = walker.walk(p, d, RNG.uniform(*len_rng), target=0.35 * r)
            if len(path) < 8:
                continue
            taper = r * (0.75 + 0.25 * np.sin(np.linspace(0, np.pi, len(path))))
            paint(grid, labels, path, taper, lab, free())
            # 枝分かれ
            if RNG.random() < 0.35:
                k = len(path) // 2
                branch = walker.walk(path[k], unit(RNG.normal(0, 1, 3)), RNG.uniform(4, 9), target=0.35 * r * 0.8)
                paint(grid, labels, branch, r * 0.8, lab, free())
            count += 1
            if count >= n_cords:
                break
        print(f"  肉柱（{side}）: {count} 本, {(labels == lab).sum() * H ** 3 / 1000:.2f} mL")

    # 中隔縁柱: 右心室の中隔の中ほどから前乳頭筋の根もとへ内腔を横切る。中隔の上では室上稜のほうへ隆起として続く
    base, apex, ax, L = out["RV"]
    sep_surface, _ = grid.coords(cav["cavRV"] & (D > 0.3) & (D < 1.0) & (dist["cavLV"] < SEPTUM_V + 2))
    tp = (sep_surface - base) @ ax / L
    cand = sep_surface[(tp > 0.42) & (tp < 0.55)]
    papA, _ = load(data["papRVant"])
    # 前乳頭筋の根もと: 前乳頭筋のうち心尖にいちばん近いあたり（下 1/4 の点の重心）
    tpa = (papA - base) @ ax / L
    root = papA[tpa >= np.quantile(tpa, 0.8)].mean(0)
    start = cand[np.argmin(np.linalg.norm(cand - root, axis=1))]
    start = cand[np.argsort(np.linalg.norm(cand - root, axis=1))[len(cand) // 6]]  # 根もとから少し離れた中隔の点
    mid = (start + root) / 2 + ax * 4.0
    bez = np.array([(1 - t) ** 2 * start + 2 * (1 - t) * t * mid + t * t * root for t in np.linspace(0, 1, 40)])
    paint(grid, labels, bez, np.linspace(2.3, 1.8, 40), MODERATOR, free() | (labels == TRAB_RV))
    walker = Walker(grid, D, lambda p: cav["cavRV"][tuple(grid.index(p))])
    up = walker.walk(start, -ax + 0.3 * unit(seg["pv_center"] - start), 20, target=0.6, wiggle=0.03)
    paint(grid, labels, up, np.linspace(2.0, 1.2, len(up)), MODERATOR, free() | (labels == TRAB_RV))
    print(f"  中隔縁柱: {(labels == MODERATOR).sum() * H ** 3 / 1000:.2f} mL")
    out["moderator"] = (start, root, bez)

    # 分界稜と櫛状筋: 右心房の外側の壁を、上大静脈の口から下大静脈の口へ縦に走る隆起と、そこから右心耳へ向かう平行な隆起
    vess = {v["name"].lower(): load(v) for v in data["vessels"]}
    ra_pts, _ = grid.coords(cav["cavRA"])
    svc = vess["superior vena cava"][0]
    ivc = np.vstack([load(v)[0] for v in data["vessels"] if v["name"].lower() == "inferior vena cava"])
    svc_mouth = svc[np.argsort(svc[:, 1])[: max(20, len(svc) // 20)]].mean(0)
    ivc_mouth = ivc[np.argsort(-ivc[:, 1])[: max(20, len(ivc) // 20)]].mean(0)
    ra_center = ra_pts.mean(0)
    lateral = unit(np.array([-1.0, 0, 0.4]))  # 右心房の外側（本人の右・やや前）
    walkerA = Walker(grid, D, lambda p: cav["cavRA"][tuple(grid.index(p))])
    a = ra_center + lateral * 40
    a = ra_pts[np.argmin(np.linalg.norm(ra_pts - (svc_mouth + lateral * 12 - np.array([0, 6, 0])), axis=1))]
    b = ra_pts[np.argmin(np.linalg.norm(ra_pts - (ivc_mouth + lateral * 12 + np.array([0, 6, 0])), axis=1))]
    crista = walkerA.walk(a, b - a, np.linalg.norm(b - a) * 1.2, target=0.5, wiggle=0.02, bend=lambda p, d: 0.25 * unit(b - p))
    paint(grid, labels, crista, 1.7, CRISTA, free())
    # 右心耳の先: 右心房の内腔で、上大静脈の口から前・内側（本人の左）へいちばん遠い所
    score = (ra_pts - svc_mouth) @ unit(np.array([0.5, 0.2, 1.0]))
    tip = ra_pts[np.argmax(score)]
    n_pect = 0
    for k in np.linspace(0.08, 0.75, 11):
        p = crista[int(k * (len(crista) - 1))]
        path = walkerA.walk(p, tip - p, RNG.uniform(14, 24), target=0.45, wiggle=0.06, bend=lambda q, d: 0.15 * unit(tip - q))
        if len(path) > 6:
            paint(grid, labels, path, np.linspace(1.15, 0.7, len(path)), PECTINATE, free())
            n_pect += 1
    print(f"  分界稜 {(labels == CRISTA).sum() * H ** 3 / 1000:.2f} mL, 櫛状筋 {n_pect} 本 {(labels == PECTINATE).sum() * H ** 3 / 1000:.2f} mL")
    out["crista"] = crista

    # 卵円窩: 心房中隔の右心房側の面の下・後ろ寄りの楕円のくぼみ。くぼみの底（左心房側の薄い膜）が卵円窩、ふちが卵円窩縁
    Pi, idx = grid.coords(labels == IAS)
    surf = Pi[dist["cavRA"][tuple(idx.T)] <= 1.0]
    c0 = surf.mean(0) + np.array([0, -0.15, -0.1]) * (surf.max(0) - surf.min(0))
    center = surf[np.argmin(np.linalg.norm(surf - c0, axis=1))]
    # 中隔の面の向き（右心房から左心房へ）
    nrm = unit(seg_center(grid, cav["cavLA"]) - seg_center(grid, cav["cavRA"]))
    rel = Pi - center
    inplane = np.linalg.norm(rel - np.outer(rel @ nrm, nrm), axis=1)
    dla = dist["cavLA"][tuple(idx.T)]
    in_fossa = inplane <= 8.0
    # 底は中隔の左心房側のいちばん深い層（右心房の壁と左心房の壁の間にすき間があるので、左心房の内腔からの距離の最小から測る）
    floor = in_fossa & (dla <= dla[in_fossa].min() + 1.6)
    labels[tuple(idx[in_fossa & ~floor].T)] = 0
    labels[tuple(idx[floor].T)] = FOSSA
    # 卵円窩縁: くぼみのまわりの輪を右心房の側へ少し盛り上げる
    Pr, ridx = grid.coords(cav["cavRA"] & (labels == 0) & (grid.dist(labels == IAS) <= 1.0))
    relr = Pr - center
    ring = np.linalg.norm(relr - np.outer(relr @ nrm, nrm), axis=1)
    labels[tuple(ridx[(ring > 8.0) & (ring < 10.5)].T)] = IAS
    print(f"  卵円窩: 底 {(labels == FOSSA).sum() * H ** 3 / 1000:.2f} mL")
    out["fossa"] = (center, nrm)
    return out


def label_surface(grid, mask, outer=None, smooth=SMOOTH, level=0.56, min_faces=60):
    """ボクセルの集まりの面（m）。outer＝(点, 三角形)（mm）を渡すと、その面から SNAP 以内の点を元の面へ吸い付ける"""
    lo_i = np.maximum(np.argwhere(mask).min(0) - 4, 0)
    hi_i = np.minimum(np.argwhere(mask).max(0) + 5, np.array(grid.shape))
    sub = mask[tuple(slice(lo_i[k], hi_i[k]) for k in range(3))]
    origin = grid.lo + lo_i * H
    f = ndi.gaussian_filter(np.pad(sub, 2).astype(np.float32), smooth)
    v, faces = surface_nets(f, level)
    v = taubin(v, faces, iterations=10)
    mm = origin + (v - 2 + 0.5) * H
    if outer is not None:
        mm, _ = kidney.snap(mm, *outer, reach=SNAP)
    n = len(mm)
    adj = sp.coo_matrix((np.ones(len(faces) * 3), (np.repeat(faces[:, 0], 3), faces.ravel())), shape=(n, n))
    k, comp = connected_components(adj, directed=False)
    size = np.bincount(comp[faces[:, 0]], minlength=k)
    faces = faces[size[comp[faces[:, 0]]] >= min_faces]
    used = np.unique(faces)
    remap = -np.ones(n, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return mm[used] / 1000.0, remap[faces]


# 房室弁の尖（BodyParts3D の形に腱索が一緒に入っている）: (入力のキー, ID の末尾, 尖の名前, 腱索の名前)
LEAFLETS = [
    ("mitralA", "mitral_a", "Anterior leaflet of mitral valve", "Chordae tendineae of anterior leaflet of mitral valve"),
    ("mitralP", "mitral_p", "Posterior leaflet of mitral valve", "Chordae tendineae of posterior leaflet of mitral valve"),
    ("tricA", "tric_a", "Anterior leaflet of tricuspid valve", "Chordae tendineae of anterior leaflet of tricuspid valve"),
    ("tricP", "tric_p", "Posterior leaflet of tricuspid valve", "Chordae tendineae of posterior leaflet of tricuspid valve"),
    ("tricS", "tric_s", "Septal leaflet of tricuspid valve", "Chordae tendineae of septal leaflet of tricuspid valve"),
]
CHORD_R = 3.0  # ひも状かを見るまわりの広さ（mm）
CHORD_FLAT = 0.3  # 主成分の2つめ÷1つめがこれより小さければひも（腱索）。膜は 0.5〜1、細く長いひもは 0.1 以下


def subdivide4(P, F):
    """三角形を4つに分ける（辺の中点を足す。元の点の番号はそのまま）"""
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1)
    uniq, inv = np.unique(e, axis=0, return_inverse=True)
    inv = inv.ravel()
    mid = len(P) + inv
    P2 = np.vstack([P, (P[uniq[:, 0]] + P[uniq[:, 1]]) / 2])
    k = len(F)
    ab, bc, ca = mid[:k], mid[k:2 * k], mid[2 * k:]
    a, b, c = F[:, 0], F[:, 1], F[:, 2]
    F2 = np.concatenate([np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1), np.stack([ca, bc, c], 1), np.stack([ab, bc, ca], 1)])
    return P2, F2


def split_chordae(P, F):
    """弁の尖の形を、膜（尖）とひも（腱索）に分ける。返り値 (尖の三角形, 腱索の三角形)"""
    # まわりは面の上の道のり CHORD_R 以内の点（空間の距離だと、となりの腱索まで入ってしまう）。
    # 腱索の三角形はひもの向きに長い（辺が 3mm を超える）ので、測るときだけ形を2回4つに分けて点を細かくする
    n = len(P)
    Ps, Fs = P, F
    for _ in range(2):
        Ps, Fs = subdivide4(Ps, Fs)
    m = len(Ps)
    e = np.concatenate([Fs[:, [0, 1]], Fs[:, [1, 2]], Fs[:, [2, 0]]])
    w = np.linalg.norm(Ps[e[:, 0]] - Ps[e[:, 1]], axis=1)
    G = sp.coo_matrix((np.concatenate([w, w]), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(m, m)).tocsr()
    from scipy.sparse.csgraph import dijkstra
    lin = np.ones(n)
    for start in range(0, n, 400):
        rows = np.arange(start, min(n, start + 400))
        Dg = dijkstra(G, indices=rows, limit=CHORD_R)
        for row, i in enumerate(rows):
            nb = np.isfinite(Dg[row])
            if nb.sum() < 6:
                continue
            Q = Ps[nb] - Ps[nb].mean(0)
            ev = np.sort(np.linalg.eigvalsh(Q.T @ Q))[::-1]
            lin[i] = ev[1] / max(ev[0], 1e-12)
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    strand = lin < CHORD_FLAT
    # となりの点とならす（3回の多数決）
    A = sp.coo_matrix((np.ones(len(e) * 2), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(n, n)).tocsr()
    A.data[:] = 1
    deg = np.asarray(A.sum(1)).ravel() + 1
    for _ in range(3):
        strand = (A @ strand.astype(float) + strand) / deg > 0.5
    face_strand = strand[F].sum(1) >= 2
    # 腱索のかけらのうち小さいもの（膜のしわ）は膜に戻す
    Fs = F[face_strand]
    if len(Fs):
        adj = sp.coo_matrix((np.ones(len(Fs) * 3), (np.repeat(Fs[:, 0], 3), Fs.ravel())), shape=(n, n))
        k, comp = connected_components(adj, directed=False)
        size = np.bincount(comp[Fs[:, 0]], minlength=k)
        small = size[comp[Fs[:, 0]]] < 40
        idx = np.nonzero(face_strand)[0]
        face_strand[idx[small]] = False
    # 尖（膜）は、いちばん大きなまとまりだけ（腱索の分かれ目や先に残った小さな島は腱索）
    Fl = F[~face_strand]
    if len(Fl):
        adj = sp.coo_matrix((np.ones(len(Fl) * 3), (np.repeat(Fl[:, 0], 3), Fl.ravel())), shape=(n, n))
        k, comp = connected_components(adj, directed=False)
        size = np.bincount(comp[Fl[:, 0]], minlength=k)
        keep = size[comp[Fl[:, 0]]] >= 0.15 * len(Fl)
        idx = np.nonzero(~face_strand)[0]
        face_strand[idx[~keep]] = True
    return F[~face_strand], F[face_strand]


def compact(P, F):
    used = np.unique(F)
    remap = -np.ones(len(P), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return P[used], remap[F]


def tube(path, radius, sides=10, cap=True):
    """道（点の並び、mm）に沿った管の形（m）。radius は点ごとの半径（mm）。返り値 (点, 三角形)"""
    path = np.asarray(path, dtype=np.float64)
    keep = np.concatenate([[True], np.linalg.norm(np.diff(path, axis=0), axis=1) > 1e-6])
    path = path[keep]
    radius = np.broadcast_to(np.asarray(radius, dtype=np.float64), (len(keep),))[keep]
    n = len(path)
    if n < 2:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    # 平行移動の枠（ねじれない）
    ref = np.array([0.0, 1.0, 0.0]) if abs(T[0][1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N = [unit(np.cross(T[0], ref))]
    for i in range(1, n):
        v = N[-1] - np.dot(N[-1], T[i]) * T[i]
        N.append(unit(v))
    N = np.array(N)
    B = np.cross(T, N)
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ring = np.cos(ang)[None, :, None] * N[:, None, :] + np.sin(ang)[None, :, None] * B[:, None, :]
    V = (path[:, None, :] + radius[:, None, None] * ring).reshape(-1, 3)
    faces = []
    for i in range(n - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            c, d = a + sides, b + sides
            faces += [[a, c, b], [b, c, d]]
    if cap:
        V = np.vstack([V, path[0] - T[0] * radius[0] * 0.5, path[-1] + T[-1] * radius[-1] * 0.5])
        s0, s1 = len(V) - 2, len(V) - 1
        last = (n - 1) * sides
        for j in range(sides):
            faces.append([s0, j, (j + 1) % sides])
            faces.append([s1, last + (j + 1) % sides, last + j])
    return V / 1000.0, np.array(faces, dtype=np.int64)


def join(meshes):
    Ps, Fs, o = [], [], 0
    for P, F in meshes:
        if not len(F):
            continue
        Ps.append(P)
        Fs.append(F + o)
        o += len(P)
    return np.vstack(Ps), np.vstack(Fs)


def spindle(center, direction, length, r):
    """紡錘の形（結節）の道と半径"""
    t = np.linspace(-0.5, 0.5, 24)
    path = center + np.outer(t * length, unit(direction))
    return path, r * np.sqrt(np.clip(1 - (2 * t) ** 2, 0.02, 1))


def conduction(grid, data, seg, geo):
    """刺激伝導系（洞房結節・房室結節・房室束・右脚・左脚・プルキンエ線維）の道すじ。返り値 {部品の末尾: [(道, 半径)]}"""
    labels, cav = seg["labels"], seg["cav"]
    myo = labels > 0
    SD = grid.dist(myo) - grid.dist(~myo)  # 内腔の側が＋、心筋の中が−（mm）
    out = {}
    # 洞房結節: 分界稜の上端（上大静脈の口の外側）の心外膜の下
    crista = geo["crista"]
    walkerRA = Walker(grid, SD, lambda p: True)
    top = crista[0]
    n = walkerRA.normal(top)
    thick = 2.5
    center = top - n * (thick + 0.6)
    out["san"] = [spindle(center, crista[min(12, len(crista) - 1)] - crista[0] + np.array([0, 4.0, 0]), 13.0, 1.7)]
    # 房室結節: コッホの三角（冠状静脈洞の口と三尖弁の中隔尖の付け根の間）の心房中隔の中
    cs, _ = load(data["coronarySinus"])
    dRA = grid.sample(seg["dist"]["cavRA"], cs)
    cs_mouth = cs[dRA <= np.quantile(dRA, 0.05)].mean(0)
    sept_leaf, _ = load(data["tricS"])
    base_rv, apex_rv, ax_rv, L_rv = geo["RV"]
    hinge = sept_leaf[(sept_leaf - base_rv) @ ax_rv <= np.quantile((sept_leaf - base_rv) @ ax_rv, 0.1)]
    hinge_pt = hinge[np.argmin(np.linalg.norm(hinge - cs_mouth, axis=1))]
    target = cs_mouth + 0.55 * (hinge_pt - cs_mouth)
    Pm, idx = grid.coords((labels == IAS) | (labels == IVS) | (labels == RA))
    depth = SD[tuple(idx.T)]
    ok = (depth < -0.8) & (depth > -2.5)
    avn = Pm[ok][np.argmin(np.linalg.norm(Pm[ok] - target, axis=1))]
    # 房室束: 房室結節から心室中隔の上の縁（大動脈弁の下）へ
    aortic = np.vstack([load(v)[0] for v in data["vessels"] if "aortic valve" in v["name"].lower()])
    Pi, iidx = grid.coords(labels == IVS)
    crest_target = aortic.mean(0) - unit(geo["LV"][2]) * -12.0
    crest_target = aortic[np.argmin(aortic[:, 1])] + geo["LV"][2] * 6.0
    his_end = Pi[np.argmin(np.linalg.norm(Pi - crest_target, axis=1))]
    out["avn"] = [spindle(avn, his_end - avn, 7.0, 1.4)]
    his = np.array([avn + (his_end - avn) * t for t in np.linspace(0.25, 1, 20)])
    out["his"] = [(his, np.full(len(his), 1.0))]
    # 右脚: 右心室の中隔の心内膜の下を中隔縁柱の根もとへ下り、中隔縁柱の中を前乳頭筋へ
    start_mb, root_mb, bez = geo["moderator"]
    inRV = lambda p: (cav["cavRV"] | (labels == IVS) | (labels == RV) | (labels == MODERATOR) | (labels == TRAB_RV))[tuple(grid.index(p))]
    wRV = Walker(grid, SD, inRV)
    p0 = his_end + (start_mb - his_end) * 0.05
    rbb = wRV.walk(p0, start_mb - p0, np.linalg.norm(start_mb - p0) * 1.3, target=-0.7, wiggle=0.02, bend=lambda p, d: 0.3 * unit(start_mb - p))
    rbb = np.vstack([his_end, rbb, bez])
    out["rbb"] = [(rbb, np.linspace(0.8, 0.55, len(rbb)))]
    # 左脚: 左心室の中隔の心内膜の下を扇のように。前枝は前乳頭筋へ、後枝は後乳頭筋へ、中隔枝は心尖へ
    base_lv, apex_lv, ax_lv, L_lv = geo["LV"]
    inLV = lambda p: (cav["cavLV"] | (labels == IVS) | (labels == LV) | (labels == TRAB_LV))[tuple(grid.index(p))]
    wLV = Walker(grid, SD, inLV)
    lbb = []
    ends = []
    for key in ("papLVant", "papLVpost"):
        pp, _ = load(data[key])
        tp = (pp - base_lv) @ ax_lv
        goal = pp[tp >= np.quantile(tp, 0.85)].mean(0)
        path = wLV.walk(his_end, goal - his_end, np.linalg.norm(goal - his_end) * 1.3, target=-0.7, wiggle=0.03, bend=lambda p, d, g=goal: 0.3 * unit(g - p))
        path = np.vstack([his_end, path])
        lbb.append((path, np.linspace(0.85, 0.5, len(path))))
        ends.append(path[-1])
    for frac in (0.35, 0.65):
        goal = base_lv + ax_lv * L_lv * 0.85
        path = wLV.walk(his_end, goal - his_end, L_lv * 0.8, target=-0.7, wiggle=0.05, bend=lambda p, d, g=goal: 0.2 * unit(g - p))
        lbb.append((np.vstack([his_end, path]), np.linspace(0.6, 0.4, len(path) + 1)))
        ends.append(path[-1])
    out["lbb"] = lbb
    # プルキンエ線維: 脚の先から心内膜の下を網のように
    purk = []
    for walker, starts, count in ((wLV, ends, 70), (wRV, [rbb[-1], rbb[len(rbb) // 2]], 40)):
        tips = list(starts)
        for _ in range(count):
            s0 = tips[RNG.integers(len(tips))]
            path = walker.walk(s0, RNG.normal(0, 1, 3), RNG.uniform(8, 22), target=-0.35, wiggle=0.25)
            if len(path) > 6:
                purk.append((path, np.full(len(path), 0.28)))
                tips.append(path[-1])
                tips.append(path[len(path) // 2])
    out["purkinje"] = purk
    print("  刺激伝導系:", {k: len(v) for k, v in out.items()})
    return out


def rings(data, geo):
    """線維輪（4つの弁の付け根の輪）。返り値 {部品の末尾: (道, 半径)}"""
    out = {}

    def ring_of(points, center, axis, pick_max, bins=40):
        u = unit(np.cross(axis, [0.3, 0.9, 0.1]))
        v = np.cross(axis, u)
        rel = points - center
        ang = np.arctan2(rel @ v, rel @ u)
        h = rel @ axis
        loop = []
        for k in range(bins):
            sel = (ang >= -np.pi + 2 * np.pi * k / bins) & (ang < -np.pi + 2 * np.pi * (k + 1) / bins)
            if sel.sum() < 2:
                continue
            q = points[sel]
            hh = h[sel]
            loop.append(q[np.argmax(hh) if pick_max else np.argmin(hh)])
        loop = np.array(loop)
        # 輪をならす（となりの3点の平均を3回）
        for _ in range(3):
            loop = (np.roll(loop, 1, 0) + loop + np.roll(loop, -1, 0)) / 3
        return np.vstack([loop, loop[:1]])

    for key, leaflets, side in (("mitral", ("mitralA", "mitralP"), "LV"), ("tricuspid", ("tricA", "tricP", "tricS"), "RV")):
        pts = np.vstack([geo["leaflet_sheets"][k] for k in leaflets])
        base, apex, ax, L = geo[side]
        out[key] = (ring_of(pts, pts.mean(0), -ax, True), 1.3)
    for key, word in (("aortic", "aortic valve"), ("pulmonary", "pulmonary valve")):
        pts = np.vstack([load(v)[0] for v in data["vessels"] if word in v["name"].lower()])
        vessel = [load(v)[0] for v in data["vessels"] if v["name"].lower() == ("pulmonary trunk" if key == "pulmonary" else "")]
        target = vessel[0].mean(0) if vessel else load(data["aorta"])[0].mean(0)
        axis = unit(target - pts.mean(0))
        out[key] = (ring_of(pts, pts.mean(0), axis, False), 1.0)
    return out


def shells(grid, data, seg):
    """心外膜・心膜腔・漿膜性心膜の壁側板・線維性心膜・心内膜の薄い殻（距離の場の等値面）"""
    labels, cav = seg["labels"], seg["cav"]
    myo = labels > 0
    heart = myo | cav["cavLV"] | cav["cavRV"] | cav["cavRA"] | cav["cavLA"]
    heart = ndi.binary_closing(heart, structure=kidney.ball(1.5))
    # 大血管の根もと（心膜の袋の中に入る所）
    roots = np.zeros(grid.shape, dtype=bool)
    for v in data["vessels"] + [data["aorta"]]:
        name = v.get("name", "").lower()
        if any(w in name for w in ("vena cava", "pulmonary trunk", "pulmonary vein", "aorta")):
            P, F = merge(load(v))
            roots |= grid.voxelize(*kidney.cap(P, F)[:2])
    la_top = load(data["wallLA"])[0][:, 1].max()
    y = grid.axes[1][None, :, None]
    cut = la_top + 10.0  # 心膜の袋の上の端（大血管の外膜に移る所）
    out = {}

    def shell(field, a, b, clip=None, sigma=1.0):
        f = ndi.gaussian_filter(field, sigma)
        g = np.minimum(f - a, b - f)
        if clip is not None:
            g = np.minimum(g, clip)
        v, faces = surface_nets(np.pad(g, 1, constant_values=-1), 0.0)
        v = taubin(v, faces, iterations=8)
        mm = grid.lo + (v - 1 + 0.5) * H
        return compact_big(mm / 1000.0, faces)

    dh = ndi.gaussian_filter(grid.dist(heart) - grid.dist(~heart), 1.0)
    below = np.broadcast_to(cut - y, grid.shape).astype(np.float32)
    out["epicardium"] = shell(dh, 0.15, 0.5, clip=np.broadcast_to(la_top + 4 - y, grid.shape).astype(np.float32), sigma=0.6)
    # 心膜の袋は溝やくぼみに入りこまないので、閉じて（SAC_CLOSE）大きくならす（ボクセルの段が輪の模様に出ないように）
    sac = ndi.binary_closing(heart | roots, structure=kidney.ball(SAC_CLOSE))
    ds = ndi.gaussian_filter(grid.dist(sac) - grid.dist(~sac), 2.0)
    out["pericardial_cavity"] = shell(ds, 0.5, 1.6, clip=below, sigma=0.8)
    out["serous_parietal"] = shell(ds, 1.6, 2.0, clip=below, sigma=0.8)
    out["fibrous_pericardium"] = shell(ds, 2.0, 3.2, clip=below, sigma=0.8)
    lumen = (cav["cavLV"] | cav["cavRV"] | cav["cavRA"] | cav["cavLA"]) & ~myo
    dm = grid.dist(myo)
    out["endocardium"] = shell(np.where(lumen, dm, -1.0).astype(np.float32), 0.1, 0.4, sigma=0.5)
    for k, (P, F) in out.items():
        print(f"  {k}: {len(P)} 点 {len(F)} 三角形")
    return out


def compact_big(P, F, min_faces=200):
    n = len(P)
    adj = sp.coo_matrix((np.ones(len(F) * 3), (np.repeat(F[:, 0], 3), F.ravel())), shape=(n, n))
    k, comp = connected_components(adj, directed=False)
    size = np.bincount(comp[F[:, 0]], minlength=k)
    F = F[size[comp[F[:, 0]]] >= min_faces]
    return compact(P, F)


def seg_center(grid, mask):
    P, _ = grid.coords(mask)
    return P.mean(0)


def check_images(grid, labels, cav, name, marks=()):
    from PIL import Image

    nx, ny, nz = grid.shape
    for axis, label in ((1, "y"), (2, "z")):
        for frac in (0.35, 0.5, 0.62):
            k = int(grid.shape[axis] * frac)
            sl = [slice(None)] * 3
            sl[axis] = k
            lab = labels[tuple(sl)]
            img = np.full(lab.shape + (3,), 245, dtype=np.uint8)
            for c, (key, m) in enumerate(cav.items()):
                img[m[tuple(sl)]] = (225, 225, 235)
            for v, c in COLORS.items():
                img[lab == v] = c
            # 水平断（y）は下から見る（前が上、本人の右が左）。前頭断（z）は前から見る（上が上、本人の右が左）
            if axis == 1:
                im = Image.fromarray(img.transpose(1, 0, 2)[::-1, :])  # 行=z（前が上）、列=x（本人の右=-x が左）
            else:
                im = Image.fromarray(img.transpose(1, 0, 2)[::-1, :])  # 行=y（上が上）、列=x
            im = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
            im.save(os.path.join(DIR, f"check-{name}-{label}{int(frac * 100)}.png"))


def main():
    data = json.load(open(os.path.join(DIR, "input.json")))
    allP = np.vstack([load(data[k])[0] for k in ("wallLV", "wallRV", "wallRA", "wallLA")])
    grid = Grid(allP.min(0) - PAD, allP.max(0) + PAD)
    print("格子", grid.shape)
    seg = segment_walls(grid, data)
    geo = interior(grid, data, seg)
    if CHECK:
        check_images(grid, seg["labels"], seg["cav"], "walls")
    labels = seg["labels"]
    walls = merge(*[load(data[k]) for k in ("wallLV", "wallRV", "wallRA", "wallLA")])
    parts = []

    def add(pid, name, P, F):
        parts.append({"id": f"HT_{pid}", "name": name, "positions": np.round(P, 6).ravel().tolist(), "indices": np.asarray(F).ravel().tolist()})
        print(f"  {name}: {len(P)} 点 {len(F)} 三角形")

    for pid, name, lab, snapped in WALL_PARTS:
        mask = np.isin(labels, lab)
        if not mask.any():
            raise SystemExit(f"{name} のボクセルがありません")
        P, F = label_surface(grid, mask, outer=walls if snapped else None, smooth=0.55 if not snapped else SMOOTH, level=0.5 if not snapped else 0.56, min_faces=20 if not snapped else 60)
        add(pid, name, P, F)
    geo["leaflet_sheets"] = {}
    for key, pid, name, chord_name in LEAFLETS:
        P, F = load(data[key])
        Fl, Fc = split_chordae(P, F)
        add(pid, name, *compact(P / 1000.0, Fl))
        add(f"chordae_{pid}", chord_name, *compact(P / 1000.0, Fc))
        geo["leaflet_sheets"][key] = P[np.unique(Fl)]
    for pid, items in conduction(grid, data, seg, geo).items():
        add(pid, CONDUCTION_NAMES[pid], *join([tube(path, r, sides=8 if pid == "purkinje" else 12) for path, r in items]))
    for pid, (path, r) in rings(data, geo).items():
        add(f"ring_{pid}", f"Fibrous ring of {pid} valve", *tube(path, np.full(len(path), r), sides=12, cap=False))
    for pid, (P, F) in shells(grid, data, seg).items():
        add(pid, SHELL_NAMES[pid], P, F)
    json.dump({"version": 1, "parts": parts}, open(os.path.join(DIR, "parts.json"), "w"))


if __name__ == "__main__":
    main()
