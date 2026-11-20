# 心周期（1拍の4つの部屋の容積・圧と4つの弁の流れ）を計算する。
# 式と値は ModularCirc（Alan Turing Institute、MIT License、https://github.com/alan-turing-institute/ModularCirc）の
# KorakianitisMixedModel（Korakianitis & Shi 2006 の4つの部屋・4つの弁・体循環と肺循環の0次元モデル）を numpy に移したもの。
# ModularCirc は Python 3.10 以上と numba・pandas を要るので、同じ式をここに書き直した（部屋の混合弾性・弁の Bernoulli のダイオード・RLC の血管）。
# 使い方: python3 scripts/motions/cardiac_cycle.py → public/motions/cardiac-cycle.json（1拍 = 1.0 秒を 200 点）
import json
import os

import numpy as np
from scipy.integrate import solve_ivp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
T = 1.0  # 1拍の長さ（秒。心拍数 60/分）

# 部屋: E_pas, E_act, v_ref, k_pas と活性化関数（心室は tr・td、心房は tpwb・tpww と delay）
CH = {
    "lv": dict(E_pas=1.7, E_act=2.5, v_ref=5.0, k=0.01, tr=0.30, td=0.45),
    "la": dict(E_pas=0.3, E_act=0.25, v_ref=4.0, k=0.04, tpwb=0.0, tpww=0.09, delay=0.08),
    "rv": dict(E_pas=0.67, E_act=1.15, v_ref=10.0, k=0.01, tr=0.30, td=0.45),
    "ra": dict(E_pas=0.3, E_act=0.25, v_ref=4.0, k=0.04, tpwb=0.0, tpww=0.09, delay=0.08),
}
# 心房の受動的な硬さだけ ModularCirc の値（E_pas 0.5・k_pas 0.01）から変えた: 元の値では心房の圧が 2mmHg ほどにしかならず、
# 心室の充満の7割が心房収縮のとき（A 波）になる。健康な成人は早い充満（E 波）が主で、心房収縮の分は2〜3割なので、
# 心房を少し硬く（E_pas 0.3・k_pas 0.04）して、心房収縮の分を約3割にした（左心室 141→53 mL・大動脈圧 122/81 mmHg）
# 血管: r, c, l（l が 0 なら慣性なし）
VE = {
    "sas": dict(r=0.003, c=0.08, l=0.000062),
    "sat": dict(r=0.05 + 0.5 + 0.52, c=1.6, l=0.0017),
    "svn": dict(r=0.075, c=20.5, l=0.0),
    "pas": dict(r=0.002, c=0.18, l=0.000052),
    "pat": dict(r=0.01 + 0.05 + 0.25, c=3.8, l=0.0017),
    "pvn": dict(r=0.006, c=20.5, l=0.0),
}
CQ = {"ao": 350.0, "mi": 400.0, "po": 350.0, "ti": 400.0}


def shift(t, delay):
    t = t % T
    return t + delay if t < T - delay else t + delay - T


def af_ventricle(t, tr, td):
    t = t % T
    if t < tr:
        return 0.5 * (1 - np.cos(np.pi * t / tr))
    if t < td:
        return 0.5 * (1 + np.cos(np.pi * (t - tr) / (td - tr)))
    return 0.0


def af_atrium(t, tpwb, tpww, delay):
    t = shift(t, delay)
    if tpwb <= t < tpwb + tpww:
        return 0.5 * (1 - np.cos(2 * np.pi * (t - tpwb) / tpww))
    return 0.0


def af(key, t):
    c = CH[key]
    return af_ventricle(t, c["tr"], c["td"]) if "tr" in c else af_atrium(t, c["tpwb"], c["tpww"], c["delay"])


def p_chamber(key, t, v):
    c = CH[key]
    a = af(key, t)
    return a * c["E_act"] * (v - c["v_ref"]) + (1 - a) * c["E_pas"] * (np.exp(c["k"] * (v - c["v_ref"])) - 1)


def valve(p_in, p_out, cq):
    dp = p_in - p_out
    return cq * np.sqrt(dp) if dp > 0 else 0.0


# 状態: 容積 [lv, la, rv, ra, sas, sat, svn, pas, pat, pvn] と、慣性のある血管の出る流れ [sas, sat, pas, pat]
VOL = ["lv", "la", "rv", "ra", "sas", "sat", "svn", "pas", "pat", "pvn"]
IND = ["sas", "sat", "pas", "pat"]


def pressures(t, y):
    v = dict(zip(VOL, y[: len(VOL)]))
    p = {k: p_chamber(k, t, v[k]) for k in CH}
    p.update({k: v[k] / VE[k]["c"] for k in VE})
    return v, p


def flows(t, y):
    v, p = pressures(t, y)
    q = dict(zip(IND, y[len(VOL):]))
    q["svn"] = (p["svn"] - p["ra"]) / VE["svn"]["r"]
    q["pvn"] = (p["pvn"] - p["la"]) / VE["pvn"]["r"]
    q["ao"] = valve(p["lv"], p["sas"], CQ["ao"])
    q["mi"] = valve(p["la"], p["lv"], CQ["mi"])
    q["po"] = valve(p["rv"], p["pas"], CQ["po"])
    q["ti"] = valve(p["ra"], p["rv"], CQ["ti"])
    return v, p, q


DOWN = {"sas": "sat", "sat": "svn", "pas": "pat", "pat": "pvn"}


def rhs(t, y):
    v, p, q = flows(t, y)
    dv = {
        "lv": q["mi"] - q["ao"], "la": q["pvn"] - q["mi"],
        "rv": q["ti"] - q["po"], "ra": q["svn"] - q["ti"],
        "sas": q["ao"] - q["sas"], "sat": q["sas"] - q["sat"], "svn": q["sat"] - q["svn"],
        "pas": q["po"] - q["pas"], "pat": q["pas"] - q["pat"], "pvn": q["pat"] - q["pvn"],
    }
    dq = [(p[k] - p[DOWN[k]] - q[k] * VE[k]["r"]) / VE[k]["l"] for k in IND]
    return [dv[k] for k in VOL] + dq


def main():
    # はじめの値は ModularCirc と同じ（lv 50・rv 100・sas 450・pas 200 mL、ほかは 0）。30拍まわして落ち着かせる
    y = np.array([50.0, 0, 100.0, 0, 450.0, 0, 0, 200.0, 0, 0] + [0.0] * len(IND))
    for _ in range(30):
        sol = solve_ivp(rhs, (0, T), y, method="LSODA", max_step=0.001, rtol=1e-7, atol=1e-7)
        y = sol.y[:, -1]
    n = 200
    ts = np.linspace(0, T, n, endpoint=False)
    sol = solve_ivp(rhs, (0, T), y, method="LSODA", t_eval=ts, max_step=0.001, rtol=1e-7, atol=1e-7)
    rows = [flows(t, sol.y[:, i]) for i, t in enumerate(ts)]
    out = {
        "source": "ModularCirc（MIT）の KorakianitisMixedModel の式と値",
        "period": T,
        "t": [round(float(t), 4) for t in ts],
        "volume": {k: [round(float(r[0][k]), 2) for r in rows] for k in ["la", "lv", "ra", "rv"]},
        "pressure": {k: [round(float(r[1][k]), 2) for r in rows] for k in ["la", "lv", "ra", "rv", "sas", "pas"]},
        "flow": {k: [round(float(r[2][k]), 1) for r in rows] for k in ["mi", "ao", "ti", "po", "svn", "pvn"]},
        "activation": {k: [round(float(af(k, t)), 3) for t in ts] for k in ["la", "lv", "ra", "rv"]},
    }
    for k in ["lv", "rv", "la", "ra"]:
        vol = out["volume"][k]
        print(k, "容積", min(vol), "〜", max(vol), "拍出", round(max(vol) - min(vol), 1))
    for k in ["lv", "sas", "rv", "pas"]:
        print(k, "圧", min(out["pressure"][k]), "〜", max(out["pressure"][k]))
    for k in ["mi", "ao", "ti", "po"]:
        open_ = [t for t, q in zip(out["t"], out["flow"][k]) if q > 1]
        print(k, "開いている", (open_[0], open_[-1]) if open_ else None)
    os.makedirs(os.path.join(ROOT, "public", "motions"), exist_ok=True)
    with open(os.path.join(ROOT, "public", "motions", "cardiac-cycle.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
