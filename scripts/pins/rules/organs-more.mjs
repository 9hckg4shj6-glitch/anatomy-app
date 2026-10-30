// さらに細かい部位（Phase 3 その9）のうち、心臓・脾臓・胆嚢・膵臓・舌の部位のピンの規則（scripts/pins/compute.mjs）。
// 心臓の溝は、溝の中を走る冠状動脈の幹（BodyParts3D。回旋枝は下へ出る枝を除いた FJ2649・FJ2651）を主軸にそって区間に分け、区間ごとの平均の点にいちばん近い
// 心臓の表面の点にする（near）。そのほかの点は確認画像（inspect.mjs view。SIDE=all）の上の点に当てた3Dの点。
import { loadDb, db } from "../geometry.mjs";

await loadDb();
const { elementNames, mesh } = db();

/** BodyParts3D の部品名（完全一致・小文字）か部品ID の形を主軸にそって k 区間に分け、区間ごとの点の平均を返す */
function vesselLine(names, k) {
  const P = [];
  for (const [id, name] of elementNames) {
    if (!names.includes(name.toLowerCase()) && !names.includes(id)) continue;
    const { positions } = mesh(id);
    for (let i = 0; i < positions.length; i += 3) P.push([positions[i], positions[i + 1], positions[i + 2]]);
  }
  if (!P.length) throw new Error(`部品がありません: ${names}`);
  const c = [0, 1, 2].map((j) => P.reduce((s, p) => s + p[j], 0) / P.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (p[a] - c[a]) * (p[b] - c[b]);
  let v = [1, 0.5, 0.2];
  for (let it = 0; it < 60; it++) {
    const w = [0, 1, 2].map((a) => C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2]);
    const l = Math.hypot(...w);
    v = w.map((x) => x / l);
  }
  const t = P.map((p) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2]);
  const lo = Math.min(...t), hi = Math.max(...t);
  const out = [];
  for (let i = 0; i < k; i++) {
    const sel = P.filter((_, j) => t[j] >= lo + ((hi - lo) * i) / k && t[j] <= lo + ((hi - lo) * (i + 1)) / k);
    if (sel.length) out.push([0, 1, 2].map((j) => sel.reduce((s, p) => s + p[j], 0) / sel.length));
  }
  return out;
}

const heart = { side: "all", one: true, ring: true };
export const RULES = {
  // 心臓（前から見て本人の右が画像の左。左心耳は左から＝med で見る）
  "apex-of-heart": { ...heart, ring: false, near: [0.0684, 1.1840, 0.1564], r: 0.009, n: "med+ant+inf" },
  "coronary-sulcus": { ...heart, near: [...vesselLine(["trunk of right coronary artery"], 6), ...vesselLine(["FJ2649", "FJ2651"], 3)], r: 0.006, n: "ant" },
  "anterior-interventricular-sulcus": { ...heart, near: vesselLine(["trunk of anterior interventricular branch of left coronary artery"], 5), r: 0.006, n: "ant+med" },
  "posterior-interventricular-sulcus": { ...heart, near: vesselLine(["posterior interventricular branch of right coronary artery"], 4), r: 0.006, n: "inf" },
  "right-auricle": { ...heart, ring: false, near: [[-0.0054, 1.2513, 0.1553], [-0.0027, 1.2391, 0.1608]], r: 0.009, n: "ant+lat" },
  "left-auricle": { ...heart, ring: false, near: [[0.0550, 1.2611, 0.1300], [0.0509, 1.2538, 0.1431], [0.0483, 1.2611, 0.1419]], r: 0.008, n: "med+ant" },
  // 脾臓（臓側面＝内側（lat）を向く面の中ほどの溝）
  "splenic-hilum": { side: "all", one: true, near: [[0.0637, 1.0826, 0.0827], [0.0668, 1.0786, 0.0937], [0.0729, 1.0761, 0.1070]], r: 0.009, n: "lat" },
  // 胆嚢（前から: 底は前下、頚は後ろ上で胆嚢管に続く）
  "fundus-of-gallbladder": { side: "all", one: true, near: [-0.0535, 1.0548, 0.1764], r: 0.011, n: "ant+inf" },
  "body-of-gallbladder": { side: "all", one: true, near: [-0.0472, 1.0713, 0.1709], r: 0.01, n: "ant" },
  "neck-of-gallbladder": { side: "all", one: true, near: [-0.0357, 1.0854, 0.1431], r: 0.007, n: "ant+sup" },
  // 膵臓（膵頭と膵体の間の細い所）
  "neck-of-pancreas": { side: "all", one: true, near: [[-0.0044, 1.0481, 0.1453], [-0.0016, 1.0498, 0.1459]], r: 0.01, n: "ant" },
  // 舌（上から: 分界溝は後ろに頂点のあるV字、頂点が舌盲孔）
  "terminal-sulcus-of-tongue": { side: "all", one: true, near: [[-0.0163, 1.4581, 0.1360], [-0.0114, 1.4628, 0.1319], [-0.0060, 1.4645, 0.1284], [-0.0006, 1.4629, 0.1250], [0.0048, 1.4646, 0.1284], [0.0102, 1.4633, 0.1319], [0.0152, 1.4583, 0.1360]], r: 0.004, n: "sup" },
  "foramen-caecum-of-tongue": { side: "all", one: true, near: [-0.0006, 1.4629, 0.1250], r: 0.004, n: "sup" },
};
// 喉頭の軟骨（甲状軟骨・輪状軟骨は左右を1つの形で持つ。角は右側の箱で最も上・下の点）
export const RULES2 = {
  "superior-thyroid-notch": { one: true, near: [-0.0006, 1.4125, 0.1225], r: 0.004, n: "ant+sup" },
  "oblique-line-of-thyroid-cartilage": { near: [[-0.0195, 1.4148, 0.1005], [-0.0157, 1.4066, 0.1023], [-0.0137, 1.4011, 0.1041]], r: 0.003, n: "lat" },
  "superior-horn-of-thyroid-cartilage": { ext: "sup", box: { m: [0.7, 1] }, r: 0.004, n: "sup+lat" },
  "inferior-horn-of-thyroid-cartilage": { ext: "inf", box: { m: [0.7, 1] }, r: 0.004, n: "inf+lat", cam: "lat+0.5post" },
  "arch-of-cricoid-cartilage": { one: true, ring: true, near: [[-0.0007, 1.3888, 0.1105], [-0.0047, 1.3899, 0.1103], [0.0033, 1.3899, 0.1103]], r: 0.005, n: "ant" },
  "lamina-of-cricoid-cartilage": { one: true, near: [[-0.0007, 1.3980, 0.0926], [0.0026, 1.3980, 0.0939], [-0.0040, 1.3980, 0.0939]], r: 0.007, n: "post" },
};
export const CHECKS = [
  { name: "more-thyroid", mesh: "thyroid-cartilage", views: ["ant", "lat"], ids: ["superior-thyroid-notch", "oblique-line-of-thyroid-cartilage", "superior-horn-of-thyroid-cartilage", "inferior-horn-of-thyroid-cartilage", "laryngeal-prominence"], side: "all" },
  { name: "more-cricoid", mesh: "cricoid-cartilage", views: ["ant", "post"], ids: ["arch-of-cricoid-cartilage", "lamina-of-cricoid-cartilage"], side: "all" },
  { name: "more-heart", mesh: "heart", views: ["ant", "med", "inf"], ids: ["apex-of-heart", "coronary-sulcus", "anterior-interventricular-sulcus", "posterior-interventricular-sulcus", "right-auricle", "left-auricle"], side: "all" },
  { name: "more-spleen", mesh: "spleen", views: ["lat"], ids: ["splenic-hilum"], side: "all" },
  { name: "more-gallbladder", mesh: "gallbladder", views: ["ant"], ids: ["fundus-of-gallbladder", "body-of-gallbladder", "neck-of-gallbladder"], side: "all" },
  { name: "more-pancreas", mesh: "pancreas", views: ["ant"], ids: ["neck-of-pancreas", "head-of-pancreas"], side: "all" },
  { name: "more-tongue", mesh: "tongue", views: ["sup"], ids: ["terminal-sulcus-of-tongue", "foramen-caecum-of-tongue", "root-of-tongue", "body-of-tongue"], side: "all" },
];
