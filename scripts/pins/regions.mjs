// 骨の端や突起（骨頭・顆・上顆・果・突起など）を、球の印ではなく骨の形にそった区域で示す（ピンの region）。
// region = { c: 中心, r: 半径, cut: [[nx, ny, nz, w], …], face? }: 球の中で、すべての面の表側（n·p + w ≥ 0）にある骨の表面を塗る
// （face があれば、その向きを向いた面だけ）。アプリ（src/viewer.ts のスポット・src/landmarks.ts のタップの判定）は、
// region のある部位では at・r の球の代わりにこの区域を使う。at・r は図の番号・選択肢の近さ・入れ子の判定にそのまま使う。
// 規則は scripts/pins/rules/regions.mjs の REGIONS（部位の語ID → 規則）:
//   tip: { d, h }  中心のまわりで向き d に最も出た所から、深さ h（m）までを切り取る（骨頭・上顆・果・突起）
//   cuts: [{ d, h } | { d, through: 語ID・語IDの配列（中点）・座標 } | { d, off }]（off: 中心から d の逆へ off までを残す）  さらに切る面（顆を内外に分ける、など）
//   center: 中心（無ければピンの中心）、r: 最初の半径。区域が球で切られないところまで 1mm ずつ広げる（max まで）
//   face: 向き（その向きの面だけ。脛骨の内側面のような、縁で区切られる面）、part / only: 部品を絞る（compute.mjs と同じ）
// 使い方: node scripts/pins/regions.mjs [--write] [--only id,id]
//   data-raw/pin-check/region-<ID>-<向き>.png に、区域を塗った骨を描く（向き d の正面と横から）。合ったら --write
import fs from "node:fs";
import path from "node:path";
import { baseName, loadTerms } from "../build-models.mjs";
import { loadDb, termMeshes, makeFrame, render, dot, norm, cross } from "./geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "data-raw/pin-check");
const args = process.argv.slice(2);
const write = args.includes("--write");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const { REGIONS } = await import(path.join(import.meta.dirname, "rules/regions.mjs"));
await loadDb();
const termById = new Map(loadTerms().terms.map((t) => [t.id, t]));
const pinsPath = path.join(ROOT, "content/pins.json");
const pins = JSON.parse(fs.readFileSync(pinsPath, "utf8"));

const AXES = { lat: [-1, 0, 0], med: [1, 0, 0], ant: [0, 0, 1], post: [0, 0, -1], sup: [0, 1, 0], inf: [0, -1, 0] };
function dir(spec) {
  if (Array.isArray(spec)) return norm(spec);
  const v = [0, 0, 0];
  for (const part of spec.split("+")) {
    const m = part.match(/^(-?[\d.]*)([a-z]+)$/);
    const w = m[1] === "" ? 1 : m[1] === "-" ? -1 : Number(m[1]);
    for (let k = 0; k < 3; k++) v[k] += AXES[m[2]][k] * w;
  }
  return norm(v);
}
const center = (pin) => [0, 1, 2].map((k) => pin.at.reduce((sum, p) => sum + p[k], 0) / pin.at.length);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (x) => Math.round(x * 10000) / 10000;

// 骨の表面の点（頂点と、三角形の上に約 1mm おきの点）と、その点の面の向き
const SAMPLE = 0.001;
function surfacePoints(ms) {
  const pts = [], nrm = [];
  for (const m of ms) {
    const p = m.positions, idx = m.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const A = [p[a], p[a + 1], p[a + 2]], B = [p[b], p[b + 1], p[b + 2]], C = [p[c], p[c + 1], p[c + 2]];
      const n = norm(cross(B.map((v, i) => v - A[i]), C.map((v, i) => v - A[i])));
      const k = Math.max(1, Math.ceil(Math.max(dist(A, B), dist(B, C), dist(C, A)) / SAMPLE));
      for (let i = 0; i <= k; i++) for (let j = 0; i + j <= k; j++) {
        const u = i / k, v = j / k, w = 1 - u - v;
        pts.push([0, 1, 2].map((q) => w * A[q] + u * B[q] + v * C[q]));
        nrm.push(n);
      }
    }
  }
  return { pts, nrm };
}

/** 区域の中か（アプリのシェーダーと同じ判定。境目の幅は無視） */
function inside(region, q, n) {
  if (dist(q, region.c) >= region.r) return false;
  if (region.face && dot(n, region.face) < -0.3) return false;
  return region.cut.every((pl) => pl[0] * q[0] + pl[1] * q[1] + pl[2] * q[2] + pl[3] >= 0);
}

function computeRegion(id, rule) {
  const pin = pins[id];
  if (!pin) throw new Error("ピンがありません");
  const ms = termMeshes(id, "right")
    .filter((m) => (!rule.only || m.name.toLowerCase().includes(rule.only)) && (!rule.part || baseName(m.name) === rule.part));
  if (!ms.length) throw new Error("部品がありません");
  const { pts, nrm } = surfacePoints(ms);
  const c0 = rule.center ?? center(pin);
  const r0 = rule.r ?? Math.max(pin.r * 1.5, 0.01);
  const face = rule.face ? dir(rule.face) : null;
  const cut = [];
  if ((rule.tip ? 1 : 0) + (rule.cuts?.length ?? 0) > 4) throw new Error("切る面は4枚まで（src/viewer.ts の SPOT_CUTS）");
  const plane = (d, through) => [...d, -dot(d, through)];
  for (const spec of [...(rule.tip ? [rule.tip] : []), ...(rule.cuts ?? [])]) {
    const d = dir(spec.d);
    if (spec.through !== undefined) {
      // 語ID（ピンの中心）、語IDの配列（ピンの中心どうしの中点）、座標
      const ids = typeof spec.through === "string" ? [spec.through] : typeof spec.through[0] === "string" ? spec.through : null;
      const P = ids ? [0, 1, 2].map((k) => ids.reduce((sum, other) => sum + center(pins[other])[k], 0) / ids.length) : spec.through;
      cut.push(plane(d, P));
      continue;
    }
    if (spec.off !== undefined) { cut.push([...d, spec.off - dot(d, c0)]); continue; }
    // 中心のまわり（最初の半径）で d の向きに最も出た所から h
    let top = -Infinity;
    for (const q of pts) if (dist(q, c0) < (spec.within ?? r0)) top = Math.max(top, dot(q, d));
    cut.push([...d, -(top - spec.h)]);
  }
  // 区域が球で切られないところまで広げる: 球の縁から 2mm 以内に塗る点が無くなる半径
  const max = rule.max ?? 0.07;
  let r = r0, chosen = null;
  for (; r <= max; r += 0.001) {
    const region = { c: c0, r, cut, face };
    const inner = pts.filter((q, i) => inside(region, q, nrm[i]));
    if (!inner.length) continue;
    if (Math.max(...inner.map((q) => dist(q, c0))) < r - 0.002) { chosen = inner; break; }
  }
  const warnings = [];
  if (!chosen) {
    warnings.push(`半径 ${max * 1000}mm でも区域が球で切られる`);
    chosen = pts.filter((q, i) => inside({ c: c0, r: max, cut, face }, q, nrm[i]));
    r = max;
  }
  // 球は区域を囲む最小に近いものにする（中心を区域の枠の中心へ）。広げすぎて別の所を拾わないか確かめる
  const lo = [0, 1, 2].map((k) => Math.min(...chosen.map((q) => q[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...chosen.map((q) => q[k])));
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  const R = Math.max(...chosen.map((q) => dist(q, c))) + 0.003;
  const region = { c, r: R, cut, face };
  const extra = pts.filter((q, i) => inside(region, q, nrm[i]) && dist(q, c0) >= r).length;
  if (extra) warnings.push(`囲む球が別の所 ${extra} 点を拾う`);
  // 区域の中にピンの中心（at の点）があるか
  const missed = pin.at.filter((p) => !inside({ ...region, cut: region.cut.map((pl) => [pl[0], pl[1], pl[2], pl[3] + 0.002]) }, p, face ?? [0, 0, 0])).length;
  if (missed) warnings.push(`ピンの点 ${missed} 個が区域の外`);
  const size = (hi[0] - lo[0]) * 1000, h = (hi[1] - lo[1]) * 1000, dz = (hi[2] - lo[2]) * 1000;
  return {
    region: {
      c: c.map(round), r: round(R), cut: cut.map((pl) => pl.map(round)),
      ...(face ? { face: face.map(round) } : {}),
    },
    ms, warnings, info: `${chosen.length}点・幅 ${size.toFixed(0)}×${h.toFixed(0)}×${dz.toFixed(0)}mm・球 ${(R * 1000).toFixed(0)}mm`,
  };
}

// 確認画像: 区域を見る向き（tip の向きの正面）と、それに直角な横から。区域のまわりの骨だけを描く
function views(rule, region) {
  const d = rule.view ? dir(rule.view) : rule.tip ? dir(rule.tip.d) : region.face ?? [0, 0, 1];
  const up = Math.abs(d[1]) > 0.8 ? [0, 0, 1] : [0, 1, 0];
  const side = norm(cross(d, up));
  const tilt = norm(d.map((v, i) => v + side[i] * 1.2));
  return [["face", { f: d.map((v) => -v), u: up }], ["side", { f: tilt.map((v) => -v), u: up }]];
}

fs.mkdirSync(OUT, { recursive: true });
let failed = false;
for (const [id, rule] of Object.entries(REGIONS)) {
  if (only && !only.includes(id)) continue;
  if (!termById.get(id)?.of) throw new Error(`${id} は骨の部位ではありません`);
  let result;
  try {
    result = computeRegion(id, rule);
  } catch (error) {
    console.error(`${id}: ${error.message}`);
    failed = true;
    continue;
  }
  const { region, ms, warnings, info } = result;
  console.log(`${id}（${termById.get(id).ja}）: ${info}${warnings.length ? `  ⚠ ${warnings.join("・")}` : ""}`);
  pins[id] = { ...pins[id], region };
  // 区域のまわり（球の2.2倍）の三角形だけで枠を決める
  const near = ms.map((m) => {
    const keep = [];
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t] * 3;
      if (dist([m.positions[a], m.positions[a + 1], m.positions[a + 2]], region.c) < region.r * 2.2) keep.push(m.indices[t], m.indices[t + 1], m.indices[t + 2]);
    }
    return { ...m, indices: keep };
  });
  const frameMeshes = near.map((m) => {
    const used = new Set(m.indices);
    const positions = [];
    for (const i of used) positions.push(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
    return { positions };
  });
  for (const [name, view] of views(rule, region)) {
    const frame = makeFrame(frameMeshes, view, 420, 0.1);
    const spots = [{ region, color: "#ff7a1a" }, { at: pins[id].at, r: 0.0012, color: "#202020" }];
    await render({ meshes: ms.map((m) => ({ ...m, color: "#e9dfc9" })), spots, frame, grid: false, out: path.join(OUT, `region-${id}-${name}.png`), title: `${termById.get(id).ja} ${name}` });
  }
}

if (write && !failed) {
  // 1部位1行（compute.mjs・ピン打ちツールと同じ形）
  const lines = Object.keys(pins).sort().map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(pins[id])}`);
  fs.writeFileSync(pinsPath, `{\n${lines.join(",\n")}\n}\n`);
  console.log(`content/pins.json: 区域 ${Object.values(pins).filter((p) => p.region).length} 部位`);
}
