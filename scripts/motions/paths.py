# 心臓の目印（部屋の中心・心尖・弁の輪の中心と向き・刺激伝導系の道すじ）と、血液の流れの道すじ（血管の中心線）を作る。
# 元の形は scripts/motions/export.mjs が書く data-raw/motions/app.json（アプリの GLB の頂点）。
# 使い方: python3 scripts/motions/paths.py → public/motions/heart.json・public/motions/circulation.json
#
# 血管の中心線: 語の部品の頂点（左右のある語は片側）を 2.5mm の箱でならし、近い点どうしを結んだ最小全域木の一番長い道を取り、
# 道の点ごとに、その点に一番近い頂点の真ん中へ寄せてから、ならして 3mm おきに取り直す。
# 道すじ（route）は血管の語を流れの順に並べ、前の血管の、次の血管の端に一番近い所で切ってつなぐ（大動脈弓から腕頭動脈へ、など）。
# 動脈の終わりから静脈の始まりまでは毛細血管（短い線）でつなぎ、そこで色を動脈血から静脈血へ変える（肺では逆）。
import json
import os

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
app = json.load(open(os.path.join(ROOT, "data-raw", "motions", "app.json")))
E = {k: np.array(v).reshape(-1, 3) for k, v in app["elements"].items()}
VOXEL = 0.0025
STEP = 0.003


def points(term, side=0):
    """語の部品の頂点。side が -1 なら本人の右（x<0）、1 なら左だけ"""
    p = np.concatenate([E[e] for e in app["terms"][term] if e in E])
    if side:
        p = p[p[:, 0] * side > 0.002]
    if not len(p):
        raise ValueError(f"{term} {side} に点が無い")
    return p


def centroid(element):
    return E[element].mean(0)


def resample(path, step=STEP):
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < step:
        return path[[0, -1]]
    n = max(2, int(round(s[-1] / step)) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, path[:, k]) for k in range(3)], 1)


def smooth(path, window=5):
    if len(path) <= window:
        return path
    out = path.copy()
    h = window // 2
    for i in range(h, len(path) - h):
        out[i] = path[i - h: i + h + 1].mean(0)
    return out


def centerline(p):
    keys = np.floor(p / VOXEL).astype(int)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.ravel()
    q = np.zeros((inv.max() + 1, 3))
    np.add.at(q, inv, p)
    q /= np.bincount(inv)[:, None]
    tree = cKDTree(q)
    pairs = np.array(list(tree.query_pairs(VOXEL * 2.6)))
    if not len(pairs):
        return q[[0]]
    # 部品の間にすき間がある（Z-Anatomy と BodyParts3D の境など）ときは、まとまりどうしを一番近い点で結ぶ
    from scipy.sparse.csgraph import connected_components
    d = np.linalg.norm(q[pairs[:, 0]] - q[pairs[:, 1]], axis=1)
    g = coo_matrix((d, (pairs[:, 0], pairs[:, 1])), shape=(len(q), len(q)))
    n_comp, labels = connected_components(g, directed=False)
    if n_comp > 1:
        sizes = np.bincount(labels)
        keep = [c for c in range(n_comp) if sizes[c] >= 4]
        extra = []
        for i, a in enumerate(keep):
            pa = np.where(labels == a)[0]
            tree_a = cKDTree(q[pa])
            for b in keep[i + 1:]:
                pb = np.where(labels == b)[0]
                dist, idx = tree_a.query(q[pb])
                j = int(np.argmin(dist))
                extra.append((pa[idx[j]], pb[j], dist[j]))
        if extra:
            e = np.array(extra)
            rows = np.concatenate([pairs[:, 0], e[:, 0].astype(int)])
            cols = np.concatenate([pairs[:, 1], e[:, 1].astype(int)])
            d = np.concatenate([d, e[:, 2]])
            g = coo_matrix((d, (rows, cols)), shape=(len(q), len(q)))
    # 一番遠い2点（グラフの上の距離）を結ぶ最短の道（最小全域木の道は管の面をぐるぐる回ることがあるので使わない）
    g = g + g.T
    dist = dijkstra(g, indices=0)
    a = int(np.argmax(np.where(np.isfinite(dist), dist, -1)))
    dist, pred = dijkstra(g, indices=a, return_predecessors=True)
    b = int(np.argmax(np.where(np.isfinite(dist), dist, -1)))
    path = [b]
    while path[-1] != a and path[-1] >= 0:
        path.append(pred[path[-1]])
    line = resample(smooth(q[path[::-1]], 5), STEP)
    # 面の上の道を管の中心へ寄せる: 道の向きに垂直な薄い板（±2mm）に入る頂点の真ん中へ。2回くり返す
    for _ in range(2):
        tangent = np.gradient(line, axis=0)
        tangent /= np.linalg.norm(tangent, axis=1, keepdims=True) + 1e-12
        tree_p = cKDTree(p)
        centers = line.copy()
        for i in range(len(line)):
            near = tree_p.query_ball_point(line[i], 0.02)
            if not near:
                continue
            rel = p[near] - line[i]
            slab = np.abs(rel @ tangent[i]) < 0.002
            if slab.sum() >= 3:
                centers[i] = p[near][slab].mean(0)
        line = resample(smooth(centers, 5), STEP)
    return line


def route(steps, start=None, end=None):
    """steps: (語, 側) の並び。start・end は道の初めと終わりに足す点（心臓の中など）"""
    path = [np.array([start])] if start is not None else []
    lines = [centerline(points(term, side)) for term, side in steps]
    for k, c in enumerate(lines):
        if not path:
            # 初めの血管は、次の血管に近い端で終わる向きに
            if k + 1 < len(lines):
                nxt = lines[k + 1]
                if np.linalg.norm(nxt - c[0], axis=1).min() < np.linalg.norm(nxt - c[-1], axis=1).min():
                    c = c[::-1]
            path.append(c)
            continue
        last = path[-1]
        ends = [c[0], c[-1]]
        best = None
        for e, flip in ((ends[0], False), (ends[1], True)):
            d = np.linalg.norm(last - e, axis=1)
            i = int(np.argmin(d))
            # 前の血管の初めの方で切りすぎない（少なくとも 1 点は残す）
            i = max(i, 1)
            if best is None or d[i] < best[0]:
                best = (d[i], i, flip)
        _, i, flip = best
        path[-1] = last[: i + 1]
        path.append(c[::-1] if flip else c)
    if end is not None:
        last = path[-1]
        i = int(np.argmin(np.linalg.norm(last - end, axis=1)))
        path[-1] = last[: max(i, 1) + 1]
        path.append(np.array([end]))
    return resample(np.concatenate(path))


def ring(element, toward):
    """弁の輪の中心と、輪の面に垂直な向き（toward の側を正に）"""
    p = E[element]
    c = p.mean(0)
    _, _, vt = np.linalg.svd(p - c)
    n = vt[2]
    if np.dot(n, toward - c) < 0:
        n = -n
    return c, n, float(np.sqrt(((p - c) ** 2).sum(1)).mean())


def r4(v):
    return [round(float(x), 4) for x in v]


def main():
    lv, rv, ivs = centroid("HT_lv"), centroid("HT_rv"), centroid("HT_ivs")
    la, ra = centroid("HT_la"), centroid("HT_ra")
    lv_cav = 0.6 * lv + 0.4 * ivs
    rv_cav = 0.6 * rv + 0.4 * ivs
    mitral, mitral_n, mitral_r = ring("HT_ring_mitral", lv_cav)
    tric, tric_n, tric_r = ring("HT_ring_tricuspid", rv_cav)
    aortic, aortic_n, aortic_r = ring("HT_ring_aortic", centroid("FJ3413"))
    pulm, pulm_n, pulm_r = ring("HT_ring_pulmonary", centroid("FJ2966"))
    wall = np.concatenate([E["HT_lv"], E["HT_ivs"], E["HT_rv"]])
    apex = wall[np.argmax(np.linalg.norm(wall - mitral, axis=1))]
    base = (mitral + tric) / 2
    axis = (apex - base) / np.linalg.norm(apex - base)
    print("心尖", r4(apex), "長軸の長さ(mm)", round(float(np.linalg.norm(apex - base) * 1000), 1))
    conus = centroid("HT_conus")
    lv_out = aortic - aortic_n * 0.012
    rv_out = pulm - pulm_n * 0.012

    # 刺激伝導系の道すじ（洞房結節 → 房室結節 → ヒス束 → 右脚・左脚 → 心尖のプルキンエ線維）
    san, avn, his = centroid("HT_san"), centroid("HT_avn"), centroid("HT_his")
    rbb = centerline(E["HT_rbb"])
    lbb_pts = E["HT_lbb"]
    if np.linalg.norm(rbb[-1] - his) < np.linalg.norm(rbb[0] - his):
        rbb = rbb[::-1]
    # 左脚は扇のように広がるので、ヒス束から心尖へ向かう前と後ろの2本の束（前枝・後枝）に分ける
    rel = lbb_pts - his
    side = np.cross(axis, ivs - lv)  # 中隔の面の中の、前後の向き
    lbb = []
    for sign in (1, -1):
        part = lbb_pts[(rel @ side) * sign > 0]
        c = centerline(part)
        if np.linalg.norm(c[-1] - his) < np.linalg.norm(c[0] - his):
            c = c[::-1]
        lbb.append(c)
    purkinje = E["HT_purkinje"]
    pick = np.random.default_rng(7).choice(len(purkinje), size=min(160, len(purkinje)), replace=False)
    pk = purkinje[pick]
    # プルキンエ線維の点は、心尖からの距離の順に興奮する（心尖から心底へ）
    order = np.argsort(np.linalg.norm(pk - apex, axis=1))
    heart = {
        "apex": r4(apex), "base": r4(base), "axis": r4(axis),
        "chambers": {"lv": r4(lv_cav), "rv": r4(rv_cav), "la": r4(la), "ra": r4(ra)},
        "valves": {
            "mitral": {"c": r4(mitral), "n": r4(mitral_n), "r": round(mitral_r, 4)},
            "tricuspid": {"c": r4(tric), "n": r4(tric_n), "r": round(tric_r, 4)},
            "aortic": {"c": r4(aortic), "n": r4(aortic_n), "r": round(aortic_r, 4)},
            "pulmonary": {"c": r4(pulm), "n": r4(pulm_n), "r": round(pulm_r, 4)},
        },
        "conduction": {
            "san": r4(san), "avn": r4(avn), "his": r4(his),
            "rbb": [r4(p) for p in rbb], "lbb": [[r4(p) for p in c] for c in lbb],
            "purkinje": [r4(p) for p in pk[order]],
        },
    }

    # 心臓の拍動の場面の流れ（流れの名前は cardiac-cycle.json の flow。その流れの速さで進む）
    svc = centerline(points("superior-vena-cava"))
    if svc[0][1] < svc[-1][1]:
        svc = svc[::-1]
    ivc = centerline(E["FJ3441"])  # 下大静脈の上の部分（横隔膜より上から右心房へ）
    ivc = ivc[ivc[:, 1] > ra[1] - 0.12]
    if ivc[0][1] > ivc[-1][1]:
        ivc = ivc[::-1]
    pt = centerline(points("pulmonary-trunk"))
    if np.linalg.norm(pt[0] - pulm) > np.linalg.norm(pt[-1] - pulm):
        pt = pt[::-1]
    asc = centerline(points("ascending-aorta"))
    if np.linalg.norm(asc[0] - aortic) > np.linalg.norm(asc[-1] - aortic):
        asc = asc[::-1]
    # 大動脈と肺動脈幹は、弁から一番遠い所（弓・分かれ目）まで。肺静脈は左心房から 4.5cm の内側だけ
    def until_far(line, origin):
        return line[: int(np.argmax(np.linalg.norm(line - origin, axis=1))) + 1]

    pt = until_far(pt, pulm)
    asc = until_far(asc, aortic)
    flows = []

    def seg(points_, flow):
        return {"flow": flow, "points": [r4(p) for p in resample(np.array(points_), 0.004)]}

    for vena in (svc, ivc):
        flows.append({"blood": "venous", "segments": [
            seg(list(vena) + [ra], "svn"), seg([ra, tric, rv_cav], "ti"), seg([rv_cav, conus, rv_out, pulm] + list(pt), "po"),
        ]})
    for element in app["terms"]["pulmonary-veins"]:
        vein = centerline(E[element])
        if np.linalg.norm(vein[0] - la) < np.linalg.norm(vein[-1] - la):
            vein = vein[::-1]
        vein = vein[np.linalg.norm(vein - la, axis=1) < 0.045]
        if len(vein) < 2:
            continue
        flows.append({"blood": "arterial", "segments": [
            seg(list(vein) + [la], "pvn"), seg([la, mitral, lv_cav], "mi"), seg([lv_cav, lv_out, aortic] + list(asc), "ao"),
        ]})
    heart["flows"] = flows
    # 呼吸の場面の空気の道（気管 → 主気管支 → 下葉・上葉の気管支）。吸うと下へ、吐くと上へ流す
    R, L = -1, 1
    airways = []
    for side, lobar in ((R, "right-inferior-lobar-bronchus"), (R, "right-superior-lobar-bronchus"), (L, "left-inferior-lobar-bronchus"), (L, "left-superior-lobar-bronchus")):
        # 葉気管支は区域気管支の枝まで含むので、道は主気管支までにして、葉気管支の真ん中へまっすぐ結ぶ
        line = route([("trachea", 0), ("main-bronchus", side)], end=points(lobar, side).mean(0))
        if line[0][1] < line[-1][1]:
            line = line[::-1]
        airways.append([r4(p) for p in resample(line, 0.004)])
        print("空気の道", lobar, "長さ(m)", round(float(np.linalg.norm(np.diff(line, axis=0), axis=1).sum()), 3), "上端", r4(line[0]))
    heart["airways"] = airways
    with open(os.path.join(ROOT, "public", "motions", "heart.json"), "w") as f:
        json.dump(heart, f, separators=(",", ":"))

    # 全身の流れ（体循環は左心室から右心房まで、肺循環は右心房から左心室まで）
    R, L = -1, 1
    LV_START = [lv_cav, lv_out, aortic]
    systemic = {
        "head-r": ("頭（右）", [("ascending-aorta", 0), ("aortic-arch", 0), ("brachiocephalic-trunk", 0), ("common-carotid-artery", R), ("internal-carotid-artery", R)],
                   [("internal-jugular-vein", R), ("brachiocephalic-vein", R), ("superior-vena-cava", 0)]),
        "head-l": ("頭（左）", [("ascending-aorta", 0), ("aortic-arch", 0), ("common-carotid-artery", L), ("internal-carotid-artery", L)],
                   [("internal-jugular-vein", L), ("brachiocephalic-vein", L), ("superior-vena-cava", 0)]),
        "arm-l": ("左腕", [("ascending-aorta", 0), ("aortic-arch", 0), ("subclavian-artery", L), ("axillary-artery", L), ("brachial-artery", L), ("radial-artery", L)],
                  [("radial-veins", L), ("brachial-veins", L), ("axillary-vein", L), ("subclavian-vein", L), ("brachiocephalic-vein", L), ("superior-vena-cava", 0)]),
        "arm-r": ("右腕", [("ascending-aorta", 0), ("aortic-arch", 0), ("brachiocephalic-trunk", 0), ("subclavian-artery", R), ("axillary-artery", R), ("brachial-artery", R), ("ulnar-artery", R)],
                  [("ulnar-veins", R), ("brachial-veins", R), ("axillary-vein", R), ("subclavian-vein", R), ("brachiocephalic-vein", R), ("superior-vena-cava", 0)]),
        "kidney": ("腎臓", [("ascending-aorta", 0), ("aortic-arch", 0), ("thoracic-aorta", 0), ("abdominal-aorta", 0), ("renal-artery", L)],
                   [("renal-vein", L), ("inferior-vena-cava", 0)]),
        "gut": ("腸と肝臓（門脈）", [("ascending-aorta", 0), ("aortic-arch", 0), ("thoracic-aorta", 0), ("abdominal-aorta", 0), ("superior-mesenteric-artery", 0)],
                [("superior-mesenteric-vein", 0), ("hepatic-portal-vein", 0), ("hepatic-veins", R), ("inferior-vena-cava", 0)]),
        "leg-r": ("右脚", [("ascending-aorta", 0), ("aortic-arch", 0), ("thoracic-aorta", 0), ("abdominal-aorta", 0), ("common-iliac-artery", R), ("external-iliac-artery", R), ("femoral-artery", R), ("popliteal-artery", R), ("posterior-tibial-artery", R)],
                  [("posterior-tibial-veins", R), ("popliteal-vein", R), ("femoral-vein", R), ("external-iliac-vein", R), ("common-iliac-vein", R), ("inferior-vena-cava", 0)]),
        "leg-l": ("左脚", [("ascending-aorta", 0), ("aortic-arch", 0), ("thoracic-aorta", 0), ("abdominal-aorta", 0), ("common-iliac-artery", L), ("external-iliac-artery", L), ("femoral-artery", L), ("popliteal-artery", L), ("anterior-tibial-artery", L)],
                  [("posterior-tibial-veins", L), ("popliteal-vein", L), ("femoral-vein", L), ("external-iliac-vein", L), ("common-iliac-vein", L), ("inferior-vena-cava", 0)]),
    }
    pulmonary = {
        "lung-r": ("右肺", [("pulmonary-trunk", 0), ("right-pulmonary-artery", 0), ("lateral-basal-segmental-artery", R)],
                   [("superior-basal-vein", R), ("inferior-pulmonary-vein", R)]),
        "lung-l": ("左肺", [("pulmonary-trunk", 0), ("left-pulmonary-artery", 0), ("anterior-segmental-artery", L)],
                   [("anterior-vein-of-lung", L), ("superior-pulmonary-vein", L)]),
    }
    routes = []
    for kind, table, start, end in (("systemic", systemic, None, ra), ("pulmonary", pulmonary, None, lv_cav)):
        for rid, (label, arteries, veins) in table.items():
            if kind == "systemic":
                a = route(arteries)
                if np.linalg.norm(a[0] - aortic) > np.linalg.norm(a[-1] - aortic):
                    raise ValueError(f"{rid}: 動脈の道が大動脈弁から始まらない")
                a = np.concatenate([np.array(LV_START), a])
            else:
                a = route(arteries)
                a = np.concatenate([np.array([ra, tric, rv_cav, conus, rv_out, pulm]), a])
            v = route(veins, end=end if kind == "systemic" else la)
            if kind == "pulmonary":
                v = np.concatenate([v, np.array([mitral, lv_cav])])
            # 毛細血管: 動脈の終わりから静脈の始まりへ、少し波打つ線
            a_end, v_start = a[-1], v[0]
            n = max(4, int(np.linalg.norm(v_start - a_end) / STEP))
            t = np.linspace(0, 1, n)[1:-1, None]
            wiggle = np.sin(t * np.pi * 6) * 0.004
            perp = np.cross(v_start - a_end, [0.0, 0.0, 1.0])
            perp = perp / (np.linalg.norm(perp) + 1e-9)
            cap = a_end + (v_start - a_end) * t + perp * wiggle
            a = resample(a)
            pts = np.concatenate([a, cap, resample(v)])
            routes.append({
                "id": rid, "kind": kind, "label": label,
                "capillary": [len(a), len(a) + len(cap)],
                "points": [int(round(float(x) * 10000)) for x in pts.reshape(-1)],  # 0.1mm 単位
            })
            length = np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()
            print(kind, rid, label, "点", len(pts), "長さ(m)", round(float(length), 2), "毛細血管(mm)", round(float(np.linalg.norm(v_start - a_end) * 1000), 1))
    with open(os.path.join(ROOT, "public", "motions", "circulation.json"), "w") as f:
        json.dump({"routes": routes}, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
