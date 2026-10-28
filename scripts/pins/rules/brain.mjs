// 大脳の溝と回の区分（Phase 3 その6）のピンの規則（scripts/pins/compute.mjs）。
// BodyParts3D の大脳は回ごとの形で溝の形が無い。Z-Anatomy には溝・回の区分の形（皮質の表面の一部）があるが、
// BodyParts3D の回と重なってちらつくので形としては使わず、骨に合わせて動かした形の主軸にそって点を取り、
// いちばん近い BodyParts3D の大脳の表面の点をピンにする（near）。ずれは中央値 1.4〜2.7mm。
import { loadDb, db, termMeshes, raycast } from "../geometry.mjs";

await loadDb({ za: true });
const { elementNames, mesh } = db();
const byName = new Map([...elementNames].map(([id, name]) => [name.toLowerCase(), id]));

const AX = { lat: [-1, 0, 0], med: [1, 0, 0], ant: [0, 0, 1], post: [0, 0, -1], sup: [0, 1, 0], inf: [0, -1, 0] };
const dirOf = (spec) => { const v = [0, 0, 0]; for (const p of spec.split("+")) AX[p].forEach((x, i) => (v[i] += x)); const l = Math.hypot(...v); return v.map((x) => x / l); };

/**
 * Z-Anatomy の右の形 name を主軸にそって k 区間に分け、区間ごとに pick の向きにいちばん出た点（上位 frac の平均）を返す。
 * 溝の形は溝の底まで含むので、平均では深すぎる。見る向き（pick）に出た所が溝の縁（表面）になる。回の区分（楔部など）は frac 1（ただの平均）
 */
function zaLine(name, k, pick, frac = 0.15) {
  const id = byName.get(`right ${name}`) ?? byName.get(name);
  if (!id) throw new Error(`Z-Anatomy に ${name} がありません`);
  const { positions } = mesh(id);
  const P = [];
  for (let i = 0; i < positions.length; i += 3) P.push([positions[i], positions[i + 1], positions[i + 2]]);
  const c = [0, 1, 2].map((j) => P.reduce((s, p) => s + p[j], 0) / P.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (p[a] - c[a]) * (p[b] - c[b]);
  let v = [1, 1, 1];
  for (let it = 0; it < 50; it++) {
    const w = [0, 1, 2].map((a) => C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2]);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  const t = P.map((p) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2]);
  const lo = Math.min(...t), hi = Math.max(...t);
  const out = [];
  for (let i = 0; i < k; i++) {
    const a = lo + ((hi - lo) * (i + 0.5)) / k, w = (hi - lo) / k / 2;
    const sel = P.filter((_, j) => Math.abs(t[j] - a) <= w);
    if (!sel.length) continue;
    const d = dirOf(pick);
    sel.sort((p, q) => q[0] * d[0] + q[1] * d[1] + q[2] * d[2] - (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]));
    const top = sel.slice(0, Math.max(1, Math.ceil(sel.length * frac)));
    out.push([0, 1, 2].map((j) => top.reduce((s, p) => s + p[j], 0) / top.length));
  }
  return out;
}
// 点を、pick の向きの外から当てた光線が右の大脳の表面に当たる所へ移す（溝の中に沈んだ点を、見える縁へ出す）
const right = termMeshes("cerebrum", "right");
function surface(P, pick) {
  const d = dirOf(pick);
  const hit = raycast(right, P.map((x, i) => x + d[i] * 0.06), d.map((x) => -x));
  return hit ? hit.point : P;
}
const line = (names, k, pick, { frac, proj = pick } = {}) => [names].flat().flatMap((name) => zaLine(name, k, pick, frac)).map((P) => surface(P, proj));

export const RULES = {
  "central-sulcus": { near: line("central sulcus", 7, "lat+sup"), ring: true, r: 0.007, n: "lat+sup" },
  "lateral-sulcus": { near: [...line(["lat fis-ant-horizont", "lat fis-ant-vertical"], 1, "lat"), ...line("lat fis-post", 3, "lat"), ...line("circular sulcus of insula", 4, "lat").filter((p) => p[1] > 1.53)], ring: true, r: 0.007, n: "lat" },
  "parieto-occipital-sulcus": { near: line("parieto-occipital sulcus", 5, "med"), ring: true, r: 0.007, n: "med", one: true },
  "calcarine-sulcus": { near: line("calcarine sulcus", 5, "med"), ring: true, r: 0.007, n: "med", one: true },
  "cingulate-sulcus": { near: line(["cingulate gyrus and sulcus (middle anterior part)", "cingulate gyrus and sulcus (middle posterior part)", "cingulate sulcus (marginal part*)"], 2, "sup", { proj: "med" }), ring: true, r: 0.007, n: "med", one: true },
  "precentral-sulcus": { near: line(["precentral sulcus (superior part)*", "precentral sulcus (inferior part)*"], 3, "lat+sup"), ring: true, r: 0.007, n: "lat+sup" },
  "postcentral-sulcus": { near: line("postcentral sulcus", 5, "lat+sup"), ring: true, r: 0.007, n: "lat+sup" },
  "superior-frontal-sulcus": { near: line("superior frontal sulcus", 5, "sup+lat"), ring: true, r: 0.007, n: "sup+lat" },
  "inferior-frontal-sulcus": { near: line("inferior frontal sulcus", 4, "lat"), ring: true, r: 0.007, n: "lat" },
  "superior-temporal-sulcus": { near: line("superior temporal sulcus", 7, "lat"), ring: true, r: 0.007, n: "lat" },
  "intraparietal-sulcus": { near: line("intraparietal sulcus", 3, "sup+lat"), ring: true, r: 0.007, n: "sup+lat" },
  "collateral-sulcus": { near: line("collateral sulcus", 6, "inf"), ring: true, r: 0.007, n: "inf" },
  "olfactory-sulcus": { near: line("olfactory sulcus", 4, "inf"), ring: true, r: 0.006, n: "inf" },
  cuneus: { near: line("cuneus", 3, "sup", { frac: 0.5, proj: "med" }), ring: true, r: 0.01, n: "med", one: true },
  precuneus: { near: line("precuneus", 3, "med", { frac: 1 }), ring: true, r: 0.011, n: "med", one: true },
  "lingual-gyrus": { near: line("lingual gyrus", 4, "med+inf", { frac: 1 }), ring: true, r: 0.01, n: "med+inf", one: true },
  "paracentral-lobule": { near: line("paracentral gyrus and sulcus*", 3, "med", { frac: 1 }), ring: true, r: 0.011, n: "med", one: true },
  "straight-gyrus": { near: line("straight gyrus (gyrus rectus)", 3, "inf"), ring: true, r: 0.009, n: "inf" },
  "opercular-part-of-inferior-frontal-gyrus": { near: line("opercular part of inferior frontal gyrus", 2, "lat"), ring: true, r: 0.009, n: "lat" },
  "triangular-part-of-inferior-frontal-gyrus": { near: line("triangular part of inferior frontal gyrus", 2, "lat"), ring: true, r: 0.01, n: "lat" },
  "orbital-part-of-inferior-frontal-gyrus": { near: line("orbital part of inferior frontal gyrus", 1, "lat+inf"), ring: true, r: 0.01, n: "lat+inf" },
  "transverse-temporal-gyri": { near: line("transverse temporal gyri", 2, "sup"), ring: true, r: 0.009, n: "sup", one: true },
  "frontal-pole": { ext: "ant", ring: true, r: 0.014 },
  "temporal-pole": { near: line("temporal pole", 1, "ant+inf"), ring: true, r: 0.013, n: "ant+inf" },
  "occipital-pole": { ext: "post", ring: true, r: 0.013 },
};
const LAT = ["central-sulcus", "lateral-sulcus", "precentral-sulcus", "postcentral-sulcus", "superior-frontal-sulcus", "inferior-frontal-sulcus", "superior-temporal-sulcus", "intraparietal-sulcus"];
export const CHECKS = [
  { name: "br-lat1", mesh: "cerebrum", views: ["lat"], ids: LAT.slice(0, 4) },
  { name: "br-lat2", mesh: "cerebrum", views: ["lat", "sup"], ids: LAT.slice(4) },
  { name: "br-med1", mesh: "calcarine-sulcus", views: ["med"], ids: ["parieto-occipital-sulcus", "calcarine-sulcus", "cingulate-sulcus"] },
  { name: "br-med2", mesh: "calcarine-sulcus", views: ["med"], ids: ["cuneus", "precuneus", "lingual-gyrus", "paracentral-lobule"] },
  { name: "br-inf", mesh: "cerebrum", views: ["inf"], ids: ["collateral-sulcus", "olfactory-sulcus", "straight-gyrus", "temporal-pole", "orbital-part-of-inferior-frontal-gyrus"] },
  { name: "br-ifg", mesh: "cerebrum", views: ["lat", "ant"], ids: ["opercular-part-of-inferior-frontal-gyrus", "triangular-part-of-inferior-frontal-gyrus", "orbital-part-of-inferior-frontal-gyrus", "frontal-pole", "temporal-pole", "occipital-pole"] },
  { name: "br-tt", mesh: "transverse-temporal-gyri", views: ["sup", "lat"], ids: ["transverse-temporal-gyri", "superior-temporal-sulcus"] },
];
