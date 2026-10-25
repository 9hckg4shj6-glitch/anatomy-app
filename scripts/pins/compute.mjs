// 骨の部位のピン（content/pins.json）を、骨の形から規則で計算し、確認用の画像を data-raw/pin-check/ に描く。
// 規則は scripts/pins/rules/*.mjs（RULES: 部位の語ID → 規則、CHECKS: 描く画像）。画像を見て規則を直し、合ったら書き込む。
// 使い方: node scripts/pins/compute.mjs scripts/pins/rules/shoulder.mjs [--write] [--force] [--only id,id]
//   --write  まだピンの無い部位だけ content/pins.json に書く（ピン打ちツールで直したピンを消さない）
//   --force  --write のとき、すでにあるピンも計算し直して上書きする
import fs from "node:fs";
import path from "node:path";
import { db, termMeshes, makeFrame, render, raycast, basis, dot, norm } from "./geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/pin-check");
const args = process.argv.slice(2);
const rulesFile = path.resolve(args[0]);
const write = args.includes("--write");
const force = args.includes("--force");
const { RULES: R1, RULES2 = {}, CHECKS } = await import(rulesFile);
const RULES = { ...R1, ...RULES2 };

// 方向: "lat+0.3sup" など。右側の骨で lat = -x
const AXES = { lat: [-1, 0, 0], med: [1, 0, 0], ant: [0, 0, 1], post: [0, 0, -1], sup: [0, 1, 0], inf: [0, -1, 0] };
export function dir(spec) {
  const v = [0, 0, 0];
  for (const part of spec.split("+")) {
    const m = part.match(/^(-?[\d.]*)([a-z]+)$/);
    const w = m[1] === "" ? 1 : m[1] === "-" ? -1 : Number(m[1]);
    const a = AXES[m[2]];
    if (!a) throw new Error(`方向 ${spec}`);
    for (let k = 0; k < 3; k++) v[k] += a[k] * w;
  }
  return norm(v);
}

function bounds(ms) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of ms) for (let i = 0; i < m.positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], m.positions[i]);
    hi[i % 3] = Math.max(hi[i % 3], m.positions[i]);
  }
  return { lo, hi };
}

// 骨の正規化座標 m（内→外）, s（下→上）, a（後→前）。右側の骨で外 = -x
function normalized(q, b) {
  return {
    m: (b.hi[0] - q[0]) / (b.hi[0] - b.lo[0]),
    s: (q[1] - b.lo[1]) / (b.hi[1] - b.lo[1]),
    a: (q[2] - b.lo[2]) / (b.hi[2] - b.lo[2]),
  };
}

function inBox(q, b, box = {}) {
  const n = normalized(q, b);
  // x, y, z は絶対座標（m）、m, s, a は骨の中での割合
  const v = { ...n, x: q[0], y: q[1], z: q[2] };
  return Object.entries(box).every(([k, [lo, hi]]) => v[k] >= lo && v[k] <= hi);
}

function extreme(ms, d, b, box) {
  let best = null, bestV = -Infinity;
  for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) {
    const q = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
    if (!inBox(q, b, box)) continue;
    const v = dot(q, d);
    if (v > bestV) { bestV = v; best = q; }
  }
  if (!best) throw new Error("範囲に点がありません");
  return best;
}

const frames = new Map();
function frameOf(id, ms, view, crop) {
  const key = `${id}|${view}|${crop}`;
  if (!frames.has(key)) frames.set(key, makeFrame(ms, view, 640, 0.08, crop ?? null));
  return frames.get(key);
}

function rayPoint(id, ms, [view, u, v, crop]) {
  const frame = frameOf(id, ms, view, crop);
  const { o, d } = frame.ray(u, v);
  const hit = raycast(ms, o, d);
  if (!hit) throw new Error(`${id}: ${view} (${u}, ${v}) で骨に当たりません`);
  return { point: hit.point, n: basis(view).f.map((x) => -x), surface: hit.normal };
}

// 前（または後ろ）から見た輪郭を、高さ s ごとに左右へ走査する。溝（へこみ）と、その両わきの稜を探す
function profile(ms, b, view, s, step = 0.0005) {
  const y = b.lo[1] + s * (b.hi[1] - b.lo[1]);
  const f = view === "ant" ? [0, 0, -1] : [0, 0, 1];
  const pts = [];
  for (let x = b.lo[0]; x <= b.hi[0]; x += step) {
    const o = [x, y, view === "ant" ? b.hi[2] + 0.1 : b.lo[2] - 0.1];
    const hit = raycast(ms, o, f);
    if (hit) pts.push({ x, p: hit.point, h: view === "ant" ? hit.point[2] : -hit.point[2] });
  }
  return pts;
}

function groove(ms, b, view, s, pick, sep = 6, xr = null) {
  const pts = profile(ms, b, view, s).filter((q) => !xr || (q.x >= xr[0] && q.x <= xr[1]));
  // 両わきの高い所（左右それぞれの最大）と、その間の最も低い所
  const mid = Math.floor(pts.length / 2);
  let best = null;
  for (let i = sep; i < pts.length - sep; i++) {
    // i を溝の底としたとき、左右の最大との差の小さいほう
    const left = Math.max(...pts.slice(0, i).map((q) => q.h));
    const right = Math.max(...pts.slice(i + 1).map((q) => q.h));
    const depth = Math.min(left, right) - pts[i].h;
    if (!best || depth > best.depth) best = { i, depth };
  }
  if (!best) throw new Error("溝が見つかりません");
  const { i } = best;
  if (pick === "groove") return pts[i].p;
  // 稜: 外側（x が小さい側）か内側（x が大きい側）の最大
  const side = pick === "lat" ? pts.slice(0, i) : pts.slice(i + 1);
  return side.reduce((a, q) => (q.h > a.h ? q : a)).p;
}

// 球の当てはめ（|p|² = 2p·c + k の最小二乗）
function fitSphere(points) {
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0]), B = [0, 0, 0, 0];
  for (const p of points) {
    const row = [2 * p[0], 2 * p[1], 2 * p[2], 1], y = p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
    for (let i = 0; i < 4; i++) { B[i] += row[i] * y; for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j]; }
  }
  // ガウスの消去法
  for (let i = 0; i < 4; i++) {
    let piv = i;
    for (let r = i + 1; r < 4; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [B[i], B[piv]] = [B[piv], B[i]];
    for (let r = 0; r < 4; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c < 4; c++) A[r][c] -= f * A[i][c];
      B[r] -= f * B[i];
    }
  }
  const c = [B[0] / A[0][0], B[1] / A[1][1], B[2] / A[2][2]];
  const k = B[3] / A[3][3];
  return { c, R: Math.sqrt(k + c[0] ** 2 + c[1] ** 2 + c[2] ** 2) };
}

// 骨頭（球形の関節面）の縁: 骨頭の点のまわりで球を当てはめ、軸から theta 度の向きに中心から外へ当てる
function capRim(ms, b, { ext, box, fit = 0.015, theta = 80, k = 5, phase = 0, only }) {
  const top = extreme(ms, dir(ext), b, box);
  const near = [];
  for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) {
    const q = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
    if (Math.hypot(q[0] - top[0], q[1] - top[1], q[2] - top[2]) < fit) near.push(q);
  }
  const { c, R } = fitSphere(near);
  const axis = norm(top.map((v, i) => v - c[i]));
  const e1 = norm(Math.abs(axis[1]) < 0.9 ? [axis[2], 0, -axis[0]] : [1, 0, 0]);
  const e2 = [axis[1] * e1[2] - axis[2] * e1[1], axis[2] * e1[0] - axis[0] * e1[2], axis[0] * e1[1] - axis[1] * e1[0]];
  const t = (theta * Math.PI) / 180;
  const pts = [];
  for (let j = 0; j < k; j++) {
    if (only && !only.includes(j)) continue;
    const ph = phase + (2 * Math.PI * j) / k;
    const d = [0, 1, 2].map((i) => Math.cos(t) * axis[i] + Math.sin(t) * (Math.cos(ph) * e1[i] + Math.sin(ph) * e2[i]));
    // 中心から外へ: 遠くから内へ向けて当て、最初に当たった面
    const o = c.map((v, i) => v + d[i] * 0.2);
    const hit = raycast(ms, o, d.map((v) => -v));
    if (hit) pts.push(hit.point);
  }
  return { pts, axis, R, c };
}

const round = (x) => Math.round(x * 10000) / 10000;

export function compute(id, rule) {
  // only: 部品名に含まれる語で部品を絞る（胸骨柄だけ、など）。side: "all" なら左の部品も使う
  const ms = termMeshes(id, rule.side ?? "right").filter((m) => !rule.only || m.name.toLowerCase().includes(rule.only));
  const b = bounds(ms);
  const at = [];
  let n = null;
  if (rule.ext) {
    const d = dir(rule.ext);
    at.push(extreme(ms, d, b, rule.box));
    n = d;
  }
  if (rule.ridge) {
    const { dir: ds, along = "s", from, to, k } = rule.ridge;
    const d = dir(ds);
    for (let i = 0; i < k; i++) {
      const c = from + ((to - from) * i) / Math.max(1, k - 1);
      const w = (to - from) / Math.max(1, k - 1) / 4 || 0.02;
      at.push(extreme(ms, d, b, { ...(rule.box ?? {}), [along]: [c - w, c + w] }));
    }
    n = d;
  }
  // 2つのピンの中点から、向き d に当てる（滑車切痕などのくぼみ）
  if (rule.towards) {
    const [A, B] = rule.towards.from.map((id) => pins[id].at[0]);
    const M = A.map((v, i) => (v + B[i]) / 2);
    const d = dir(rule.towards.dir);
    const hit = raycast(ms, M.map((v, i) => v - d[i] * 0.03), d);
    if (!hit) throw new Error("towards: 当たりません");
    at.push(hit.point);
    n = d.map((v) => -v);
  }
  // 切痕（縁のへこみ）: 断面ごとに dir 向きの縁の点をとり、その中で最も引っこんだ点
  if (rule.notch) {
    const { dir: ds, along = "s", from, to, steps = 24 } = rule.notch;
    const d = dir(ds);
    let best = null;
    for (let i = 0; i <= steps; i++) {
      const c = from + ((to - from) * i) / steps;
      const w = Math.abs(to - from) / steps / 2;
      let q;
      try { q = extreme(ms, d, b, { ...(rule.box ?? {}), [along]: [c - w, c + w] }); } catch { continue; }
      if (!best || dot(q, d) < dot(best, d)) best = q;
    }
    at.push(best);
    n = d;
  }
  // 2つのピンの中点にいちばん近い骨の表面の点
  if (rule.between) {
    const [A, B] = rule.between.map((id) => pins[id].at[0]);
    const M = A.map((v, i) => (v + B[i]) / 2);
    let best = null, bd = Infinity;
    for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) {
      const d = Math.hypot(m.positions[i] - M[0], m.positions[i + 1] - M[1], m.positions[i + 2] - M[2]);
      if (d < bd) { bd = d; best = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; }
    }
    at.push(best);
  }
  // 縫合: 部品 a のうち部品 b に近い（gap 以内の）点を、axis に沿って k 点えらぶ
  if (rule.seam) {
    const { a, b: bn, gap = 0.0025, k = 5, axis = 0, range } = rule.seam;
    const A = ms.filter((m) => m.name.toLowerCase().includes(a));
    const B = ms.filter((m) => m.name.toLowerCase().includes(bn));
    const cell = 0.004, grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (const m of B) for (let i = 0; i < m.positions.length; i += 3) {
      const kk = key(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
    }
    const seam = [];
    for (const m of A) for (let i = 0; i < m.positions.length; i += 3) {
      const q = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      const [cx, cy, cz] = q.map((v) => Math.floor(v / cell));
      let near = false;
      for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dz = -1; dz <= 1 && !near; dz++) {
        for (const p of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < gap) { near = true; break; }
      }
      if (near && (!range || (q[axis] >= range[0] && q[axis] <= range[1]))) seam.push(q);
    }
    if (!seam.length) throw new Error("縫合の点がありません");
    // 外面の点だけ: 頭の中心から遠いもの（各区間で最も外）
    seam.sort((p, q) => p[axis] - q[axis]);
    const lo = seam[0][axis], hi = seam[seam.length - 1][axis];
    const center = rule.seam.center ?? [0, 1.55, 0.09];
    for (let j = 0; j < k; j++) {
      const t0 = lo + ((hi - lo) * j) / k, t1 = lo + ((hi - lo) * (j + 1)) / k;
      const bucket = seam.filter((p) => p[axis] >= t0 && p[axis] <= t1);
      if (!bucket.length) continue;
      at.push(bucket.reduce((best, p) => (Math.hypot(...p.map((v, i) => v - center[i])) > Math.hypot(...best.map((v, i) => v - center[i])) ? p : best)));
    }
    n = rule.n ? dir(rule.n) : [0, 1, 0];
  }
  // nearestTo: ほかのピンの点にいちばん近い、この骨の表面の点（下顎頭に対する下顎窩など）
  if (rule.nearestTo) {
    const P = pins[rule.nearestTo].at[0];
    let best = null, bd = Infinity;
    for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) {
      const d = Math.hypot(m.positions[i] - P[0], m.positions[i + 1] - P[1], m.positions[i + 2] - P[2]);
      if (d < bd) { bd = d; best = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; }
    }
    at.push(best);
  }
  // near: 指定した座標にいちばん近い骨の表面の点
  if (rule.near) {
    const P = rule.near;
    let best = null, bd = Infinity;
    for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) {
      const d = Math.hypot(m.positions[i] - P[0], m.positions[i + 1] - P[1], m.positions[i + 2] - P[2]);
      if (d < bd) { bd = d; best = [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; }
    }
    at.push(best);
  }
  // fromMid: 正中（x=0）から外側へ当てる（下顎枝の内面など、反対側にさえぎられる所）
  if (rule.fromMid) {
    const { s: ss, a: aa } = rule.fromMid;
    const o = [0, b.lo[1] + ss * (b.hi[1] - b.lo[1]), b.lo[2] + aa * (b.hi[2] - b.lo[2])];
    const hit = raycast(ms, o, [-1, 0, 0]);
    if (!hit) throw new Error("fromMid: 当たりません");
    at.push(hit.point);
    n = [1, 0, 0];
  }
  if (rule.cap) {
    const { pts, axis } = capRim(ms, b, rule.cap);
    at.push(...pts);
    n = axis;
  }
  if (rule.groove) {
    const { view = "ant", levels, pick = "groove", between } = rule.groove;
    // between: [語ID, 語ID] のピンの x の間だけで探す（右側の骨）
    const xr = between ? between.map((id) => pins[id].at[0][0]).sort((p, q) => p - q) : null;
    for (const lv of levels) {
      if (pick === "groove" || !rule.groove.around) at.push(groove(ms, b, view, lv, pick, 6, xr));
      else {
        // 稜は、溝の底から around 以内の左右の最も高い所
        const g = groove(ms, b, view, lv, "groove", 6, xr);
        const w = rule.groove.around;
        const pts = profile(ms, b, view, lv).filter((q) => (pick === "lat" ? q.x < g[0] && q.x > g[0] - w : q.x > g[0] && q.x < g[0] + w));
        at.push(pts.reduce((a, q) => (q.h > a.h ? q : a)).p);
      }
    }
    n = dir(view);
  }
  // 高さ s の断面で、内外の位置 m（または前後の位置 a）を決め、view の方向から当てる
  for (const sl of rule.slices ?? []) {
    const y = b.lo[1] + sl.s * (b.hi[1] - b.lo[1]);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) {
      if (Math.abs(m.positions[i + 1] - y) > 0.003) continue;
      x0 = Math.min(x0, m.positions[i]); x1 = Math.max(x1, m.positions[i]);
      z0 = Math.min(z0, m.positions[i + 2]); z1 = Math.max(z1, m.positions[i + 2]);
    }
    const d = dir(sl.view).map((v) => -v); // 外から骨へ向かう向き
    const x = sl.m !== undefined ? x1 - sl.m * (x1 - x0) : (x0 + x1) / 2;
    const z = sl.a !== undefined ? z0 + sl.a * (z1 - z0) : (z0 + z1) / 2;
    const o = [x - d[0] * 0.3, y - d[1] * 0.3, z - d[2] * 0.3];
    const hit = raycast(ms, o, d);
    if (!hit) throw new Error(`断面 s=${sl.s} で当たりません`);
    at.push(hit.point);
    n ??= dir(sl.view);
  }
  // centers: 孔ごとの縁の光線の組。組ごとに中心を1点ずつ
  for (const group of rule.centers ?? []) {
    const gh = group.map((r) => rayPoint(id, ms, r));
    at.push([0, 1, 2].map((k) => gh.reduce((sum, h) => sum + h.point[k], 0) / gh.length));
    n ??= gh[0].n;
  }
  const hits = (rule.rays ?? (rule.ray ? [rule.ray] : [])).map((r) => rayPoint(id, ms, r));
  // center: 孔の縁に当てた点の平均（孔の中心）。球の範囲で孔の縁をぐるりと示す
  if (rule.center && hits.length) at.push([0, 1, 2].map((k) => hits.reduce((sum, h) => sum + h.point[k], 0) / hits.length));
  else for (const hit of hits) at.push(hit.point);
  if (hits.length) n ??= hits[0].n;
  if (rule.n) n = dir(rule.n);
  // 内側へずらす（窩の奥など）: inset m
  if (rule.inset) for (const p of at) for (let k = 0; k < 3; k++) p[k] -= n[k] * rule.inset;
  // ring: 骨を一周する部位。面の向きで塗り分けず、向きはカメラ用（v）にだけ使う
  if (rule.ring) return { at: at.map((p) => p.map(round)), r: rule.r, v: n.map(round) };
  return { at: at.map((p) => p.map(round)), r: rule.r, n: n.map(round) };
}

const { terms } = db();
const termById = new Map(terms.map((t) => [t.id, t]));
const pinsPath = path.join(ROOT, "content/pins.json");
const pins = JSON.parse(fs.readFileSync(pinsPath, "utf8"));
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
for (const [id, rule] of Object.entries(RULES)) {
  if (only && !only.includes(id)) continue;
  if (!termById.get(id)?.of) throw new Error(`${id} は骨の部位ではありません`);
  if (pins[id] && !force) continue; // 手で直したピンを残す（後の規則が参照するときもこの値を使う）
  try {
    pins[id] = compute(id, rule);
  } catch (error) {
    console.error(`${id}: ${error.message}`);
  }
}

// 確認画像: CHECKS = [{ name, mesh: 語ID（"skull-all" で頭蓋全体）, views: [...], ids: [...], crop?, side?, half? }]
fs.mkdirSync(OUT, { recursive: true });
const PALETTE = ["#ff5a1a", "#1a8cff", "#14a05a", "#c03ad0", "#e0b000", "#00b5b5", "#e0306a", "#6a5acd", "#8b4513", "#7cfc00", "#ff1493", "#00008b", "#808000", "#ff8c00", "#2f4f4f", "#dc143c"];
for (const check of CHECKS ?? []) {
  const SKULL = ["frontal-bone", "parietal-bone", "temporal-bone", "occipital-bone", "sphenoid-bone", "ethmoid-bone", "maxilla", "mandible", "zygomatic-bone", "nasal-bone", "lacrimal-bone", "palatine-bone", "vomer", "inferior-nasal-concha"];
  let ms = (check.mesh === "skull-all" ? SKULL.flatMap((t) => termMeshes(t, "all")) : termMeshes(check.mesh, check.side ?? "right")).map((m) => ({ ...m, color: "#e9dfc9" }));
  // half: 右半分（x<0）の三角形だけ描く（正中をはさむ骨の内面を見るため）
  if (check.half) ms = ms.map((m) => {
    const keep = [];
    for (let t = 0; t < m.indices.length; t += 3) {
      const cx = (m.positions[m.indices[t] * 3] + m.positions[m.indices[t + 1] * 3] + m.positions[m.indices[t + 2] * 3]) / 3;
      if (cx < 0) keep.push(m.indices[t], m.indices[t + 1], m.indices[t + 2]);
    }
    return { ...m, indices: new Uint32Array(keep) };
  });
  const spots = check.ids.filter((id) => pins[id]).map((id, i) => ({ at: pins[id].at, r: pins[id].r, n: pins[id].n, color: PALETTE[i % PALETTE.length], label: termById.get(id).ja.replace(/（.*）/, "") }));
  for (const view of check.views) {
    const frame = makeFrame(ms, view, check.size ?? 560, 0.08, check.crop ?? null);
    await render({ meshes: ms, spots, frame, out: path.join(OUT, `${check.name}-${view}.png`), title: `${check.name} ${view}` });
  }
}

if (write) {
  // 1部位1行（ピン打ちツール src/ui/admin.ts の formatPins と同じ形）
  const lines = Object.keys(pins).sort().map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(pins[id])}`);
  fs.writeFileSync(pinsPath, `{\n${lines.join(",\n")}\n}\n`);
  console.log(`content/pins.json: ${Object.keys(pins).length} 部位`);
}
