// さらに細かい部位（Phase 3 その9）のうち、小脳と脳幹の表面の部位のピンの規則（scripts/pins/compute.mjs）。
// BodyParts3D の小脳は1つの形で、虫部・小葉の区分が無い。Z-Anatomy には小葉ごとの形があるが、BodyParts3D の小脳と
// 重なってちらつくので形としては使わず（大脳の溝と同じ。rules/brain.mjs）、骨に合わせて動かした小葉の形から点を取り、
// 見る向きの外から当てた光線が BodyParts3D の小脳・延髄・橋の表面に当たる点をピンにする。
import { loadDb, db, termMeshes, raycast } from "../geometry.mjs";

await loadDb({ za: true });
const { elementNames, mesh } = db();
const byName = new Map([...elementNames].map(([id, name]) => [name.toLowerCase(), id]));

const AX = { lat: [-1, 0, 0], med: [1, 0, 0], ant: [0, 0, 1], post: [0, 0, -1], sup: [0, 1, 0], inf: [0, -1, 0] };
const dirOf = (spec) => { const v = [0, 0, 0]; for (const p of spec.split("+")) { const m = p.match(/^([\d.]*)([a-z]+)$/); AX[m[2]].forEach((x, i) => (v[i] += x * (m[1] ? Number(m[1]) : 1))); } const l = Math.hypot(...v); return v.map((x) => x / l); };
const points = (name) => {
  const id = byName.get(`right ${name}`) ?? byName.get(name);
  if (!id) throw new Error(`Z-Anatomy に ${name} がありません`);
  const { positions } = mesh(id);
  const P = [];
  for (let i = 0; i < positions.length; i += 3) P.push([positions[i], positions[i + 1], positions[i + 2]]);
  return P;
};
const mean = (P) => [0, 1, 2].map((j) => P.reduce((s, p) => s + p[j], 0) / P.length);
/** 点の列を主軸にそって k 区間に分けた平均 */
function along(P, k) {
  const c = mean(P);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (p[a] - c[a]) * (p[b] - c[b]);
  let v = [1, 0.3, 0.2];
  for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map((a) => C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2]); const l = Math.hypot(...w); v = w.map((x) => x / l); }
  const t = P.map((p) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2]);
  const lo = Math.min(...t), hi = Math.max(...t);
  const out = [];
  for (let i = 0; i < k; i++) {
    const sel = P.filter((_, j) => t[j] >= lo + ((hi - lo) * i) / k && t[j] <= lo + ((hi - lo) * (i + 1)) / k);
    if (sel.length) out.push(mean(sel));
  }
  return out;
}
/** 形 A の点のうち、形 B から gap 以内にあるもの（2つの小葉の境目＝裂） */
function seam(as, bs, gap = 0.0015) {
  const B = bs.flatMap(points);
  const cell = gap * 2, grid = new Map();
  const key = (p) => p.map((v) => Math.floor(v / cell)).join(",");
  for (const p of B) { const k = key(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  return as.flatMap(points).filter((q) => {
    const [cx, cy, cz] = q.map((v) => Math.floor(v / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const p of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < gap) return true;
    return false;
  });
}
const cerebellum = termMeshes("cerebellum", "all");
const cc = mean(cerebellum.flatMap((m) => { const P = []; for (let i = 0; i < m.positions.length; i += 3) P.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]); return P; }));
/** 点を、pick の向き（"radial" は小脳の中心から水平に外向き）の外から当てた光線が表面に当たる所へ移す */
function onto(meshes, P, pick) {
  const d = pick === "radial" ? (() => { const v = [P[0] - cc[0], 0, P[2] - cc[2]]; const l = Math.hypot(...v); return v.map((x) => x / l); })() : dirOf(pick);
  // BodyParts3D の小脳は左右2つの形で、正中にすき間がある。当たらなければ少し右（-x）へずらす
  for (const dx of [0, -0.002, -0.004, -0.006]) {
    const hit = raycast(meshes, [P[0] + dx + d[0] * 0.05, P[1] + d[1] * 0.05, P[2] + d[2] * 0.05], d.map((x) => -x));
    if (hit) return hit.point;
  }
  throw new Error(`当たりません ${P}`);
}
const cb = (P, pick) => onto(cerebellum, P, pick);
const medulla = termMeshes("medulla-oblongata", "all");
// 菱形窩（第四脳室の床）: 第四脳室の形の高さの範囲で、後ろから前へ当てた光線が橋・延髄の背側の面に当たる点（小脳は当てない）
const stem = [...termMeshes("pons", "all"), ...medulla];
const v4 = termMeshes("fourth-ventricle", "all").flatMap((m) => { const P = []; for (let i = 0; i < m.positions.length; i += 3) P.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]); return P; });
const [y0, y1] = [Math.min(...v4.map((p) => p[1])), Math.max(...v4.map((p) => p[1]))];
const floor = [];
for (const t of [0.25, 0.45, 0.65]) for (const x of [-0.004, 0]) {
  const hit = raycast(stem, [x, y0 + (y1 - y0) * t, -0.2], [0, 0, 1]);
  if (hit) floor.push(hit.point);
}

export const RULES = {
  "vermis-of-cerebellum": { side: "all", one: true, ring: true, near: [cb(mean(points("culmen")), "sup"), cb(mean(points("declive")), "sup+post"), cb(mean(points("folium of vermis")), "post"), cb(mean(points("tuber of vermis")), "post"), cb(mean(points("pyramis of vermis")), "post+inf"), cb(mean(points("uvula of vermis")), "inf")], r: 0.007, n: "post" },
  "cerebellar-hemisphere": { near: [cb(mean(points("superior semilunar lobule")), "post+0.5lat"), cb(mean(points("inferior semilunar lobule")), "post+0.5lat+0.3inf")], r: 0.015, n: "post+lat" },
  "flocculus": { near: cb(mean(points("flocculus")), "ant+0.5inf+0.3lat"), r: 0.006, n: "ant+inf+lat", cam: "ant+0.6inf+0.6lat" },
  "tonsil-of-cerebellum": { near: cb(mean(points("tonsil of cerebellum")), "inf"), r: 0.008, n: "inf", cam: "inf+0.6post" },
  "primary-fissure": { side: "all", one: true, ring: true, near: along(seam(["culmen", "right anterior quadrangular lobule", "left anterior quadrangular lobule"], ["declive", "right posterior quadrangular lobule", "left posterior quadrangular lobule"]), 7).map((P) => cb(P, "sup")), r: 0.005, n: "sup" },
  "horizontal-fissure-of-cerebellum": { ring: true, near: along(seam(["right superior semilunar lobule"], ["right inferior semilunar lobule"]), 5).map((P) => cb(P, "radial")), r: 0.005, n: "post+lat" },
  "pyramid-of-medulla-oblongata": { near: along(points("pyramid of medulla oblongata"), 3).map((P) => onto(medulla, P, "ant")), r: 0.004, n: "ant" },
  "olive": { near: onto(medulla, mean(points("olive")), "ant+lat"), r: 0.005, n: "ant+lat" },
  "middle-cerebellar-peduncle": { ext: "lat", r: 0.008, n: "lat+post", cam: "lat+0.4ant" },
  "rhomboid-fossa": { near: floor, r: 0.007, n: "post", cam: "post+0.4sup" },
};
export const CHECKS = [
  { name: "more-cerebellum", mesh: "cerebellum", views: ["post", "sup", "inf", "ant"], ids: ["vermis-of-cerebellum", "cerebellar-hemisphere", "flocculus", "tonsil-of-cerebellum", "primary-fissure", "horizontal-fissure-of-cerebellum"], side: "all" },
  { name: "more-cerebellum-fissures", mesh: "cerebellum", views: ["post", "lat"], ids: ["horizontal-fissure-of-cerebellum", "primary-fissure", "flocculus"], side: "all" },
  { name: "more-brainstem", mesh: ["medulla-oblongata", "pons"], views: ["ant", "lat", "post"], ids: ["pyramid-of-medulla-oblongata", "olive", "middle-cerebellar-peduncle", "rhomboid-fossa"], side: "all" },
];
