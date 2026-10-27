// 基本の用語（運動）で骨を動かすための関節（content/joints.json）を、骨の形と骨の部位のピンから求める。
// 関節ごとに、動かす骨（語ID）・回す中心 pivot・回す軸 axis（右側＝本人の右。正の角度でその運動の名前の向き）。
// slide の関節は回さずに axis の向きへ動かす（値は mm。肩甲骨の挙上で、鎖骨の外側端と一緒に肩甲骨と腕を持ち上げる）。
// アプリは左右のある骨は右側の部品を動かし（both のときは左側にも折り返す）、正中の骨（mid）は全部を動かす。
// 並びは体の中心から先へ。1つの部品に複数の関節が効くときは、先の関節から順に回してから根元の関節で回す。
// 使い方: node scripts/joints.mjs（data-raw/bp3d が要る）
import fs from "node:fs";
import path from "node:path";
import { loadDb, termMeshes } from "./pins/geometry.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "content/pins.json"), "utf8"));
await loadDb();

const add = (a, b) => a.map((v, k) => v + b[k]);
const sub = (a, b) => a.map((v, k) => v - b[k]);
const scale = (a, s) => a.map((v) => v * s);
const mid = (a, b) => scale(add(a, b), 0.5);
const unit = (a) => scale(a, 1 / Math.hypot(...a));
const pin = (id) => pins[id].at[0];
const round = (a) => a.map((v) => +v.toFixed(4));

function points(termId) {
  const out = [];
  for (const { positions } of termMeshes(termId, "right")) for (let i = 0; i < positions.length; i += 3) out.push([positions[i], positions[i + 1], positions[i + 2]]);
  return out;
}

/** 骨頭（上腕骨頭・大腿骨頭）の中心: ピンの近くの点に球を当てはめ、球面から離れた点（頚・結節）を除いて当てはめ直す */
function headCenter(termId, pinId, reach) {
  let pts = points(termId).filter((p) => Math.hypot(...sub(p, pin(pinId))) < reach);
  let center = null, radius = 0;
  for (let round = 0; round < 4; round++) {
    // |p|² = 2c·p + (r² - |c|²) を最小二乗で解く
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (const p of pts) {
      const row = [2 * p[0], 2 * p[1], 2 * p[2], 1], y = p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
      for (let i = 0; i < 4; i++) {
        b[i] += row[i] * y;
        for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
      }
    }
    const x = solve(A, b);
    center = x.slice(0, 3);
    radius = Math.sqrt(x[3] + center[0] ** 2 + center[1] ** 2 + center[2] ** 2);
    const keep = pts.filter((p) => Math.abs(Math.hypot(...sub(p, center)) - radius) < 0.003);
    if (keep.length < 50) break;
    pts = keep;
  }
  console.log(`${termId}: 骨頭の半径 ${(radius * 1000).toFixed(1)}mm`);
  return center;
}

function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    const p = M.reduce((best, row, k) => (k >= i && Math.abs(row[i]) > Math.abs(M[best][i]) ? k : best), i);
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const hand = ["carpal-bones", "metacarpals", "phalanges-hand"];
const forearm = ["radius", "ulna", ...hand];
const arm = ["humerus", ...forearm];
const foot = ["tarsal-bones", "metatarsals", "phalanges-foot"];
const leg = ["tibia", "fibula", "patella", ...foot];
const skull = ["frontal-bone", "parietal-bone", "temporal-bone", "occipital-bone", "sphenoid-bone", "ethmoid-bone", "maxilla", "mandible",
  "zygomatic-bone", "nasal-bone", "lacrimal-bone", "palatine-bone", "vomer", "inferior-nasal-concha"];

const shoulder = headCenter("humerus", "head-of-humerus", 0.035);
const hip = headCenter("femur", "head-of-femur", 0.035);
// 肘の屈曲の軸は上腕骨小頭と滑車の中心を通る（ピンは前面にあるので1cm後ろへ）。向きは内側上顆→外側上顆
const elbow = add(mid(pin("capitulum-of-humerus"), pin("trochlea-of-humerus")), [0, 0, -0.01]);
const elbowAxis = unit(sub(pin("lateral-epicondyle-of-humerus"), pin("medial-epicondyle-of-humerus")));
// 前腕の回内・回外の軸は橈骨頭の中心と尺骨頭を通る（ピンは表面なので少し内へ）
const radialHead = add(pin("head-of-radius"), [0, -0.006, -0.004]);
const ulnarHead = add(pin("head-of-ulna"), [0.002, 0, 0.006]);
// 膝の屈曲の軸は大腿骨の内側上顆と外側上顆を結ぶ線のあたり
const knee = mid(pin("medial-epicondyle-of-femur"), pin("lateral-epicondyle-of-femur"));
const kneeAxis = unit(sub(pin("medial-epicondyle-of-femur"), pin("lateral-epicondyle-of-femur")));
// 足関節（距腿関節）の軸は内果と外果の先を結ぶ線
const ankle = mid(pin("medial-malleolus"), pin("lateral-malleolus"));
const ankleAxis = unit(sub(pin("lateral-malleolus"), pin("medial-malleolus")));
// 足の指（中足趾節関節）: 中足骨頭（前の端）を結ぶ線のまわりに回す。母趾（hallux）とほかの指（toes）で別の関節にして、
// 動かす部品を only で絞る（足の指の骨は1つの語「指骨（足）」なので）。軸は外側→内側（中足骨頭の並びに合わせて第2〜5趾は少し斜め）で、
// 正の角度で屈曲（指が下へ）
const metatarsalHeads = Object.fromEntries(termMeshes("metatarsals", "right").map(({ name, positions }) => {
  let best = null;
  for (let i = 0; i < positions.length; i += 3) if (!best || positions[i + 2] > best[2]) best = [positions[i], positions[i + 1], positions[i + 2]];
  // 頭の先から少し後ろ・上（頭の丸みの中心のあたり）
  return [name.toLowerCase().match(/(first|second|third|fourth|fifth)/)[1], add(best, [0, 0.004, -0.009])];
}));
const toeBones = termMeshes("phalanges-foot", "right");
const greatToe = toeBones.filter(({ name }) => /big toe/i.test(name)).map(({ id }) => id);
const lesserToes = toeBones.filter(({ name }) => !/big toe/i.test(name)).map(({ id }) => id);
const capitate = (() => {
  const pts = termMeshes("capitate", "right").flatMap(({ bounds }) => [bounds[0], bounds[1]]);
  return mid(pts[0], pts[1]);
})();

const joints = {
  // 肩甲骨の挙上・下制: 鎖骨は胸鎖関節で回し、肩甲骨と腕は鎖骨の外側端と同じだけ上下させる（回すと腕が横へ振れるため）
  girdle: { ja: "胸鎖関節", moves: ["clavicle"], pivot: add(pin("sternal-end-of-clavicle"), [-0.008, 0.004, 0]), axis: [0, 0, -1], plus: "挙上" },
  // slide の pivot は動きの矢印を描く所（肩の外側）
  "girdle-lift": { ja: "肩甲骨", moves: ["scapula", ...arm], pivot: add(pin("acromial-end-of-clavicle"), [-0.03, -0.03, 0]), axis: [0, 1, 0], slide: true, plus: "挙上（mm）" },
  "shoulder-flex": { ja: "肩関節", moves: arm, pivot: shoulder, axis: [-1, 0, 0], plus: "屈曲" },
  "shoulder-abd": { ja: "肩関節", moves: arm, pivot: shoulder, axis: [0, 0, -1], plus: "外転" },
  "shoulder-rot": { ja: "肩関節", moves: arm, pivot: shoulder, axis: unit(sub(elbow, shoulder)), plus: "外旋" },
  elbow: { ja: "肘関節", moves: forearm, pivot: elbow, axis: elbowAxis, plus: "屈曲" },
  forearm: { ja: "上・下橈尺関節", moves: ["radius", ...hand], pivot: radialHead, axis: unit(sub(radialHead, ulnarHead)), plus: "回内" },
  "wrist-flex": { ja: "手関節", moves: hand, pivot: capitate, axis: [-1, 0, 0], plus: "屈曲（掌屈）" },
  "wrist-dev": { ja: "手関節", moves: hand, pivot: capitate, axis: [0, 0, -1], plus: "橈屈" },
  "hip-flex": { ja: "股関節", moves: ["femur", ...leg], pivot: hip, axis: [-1, 0, 0], plus: "屈曲" },
  "hip-abd": { ja: "股関節", moves: ["femur", ...leg], pivot: hip, axis: [0, 0, -1], plus: "外転" },
  "hip-rot": { ja: "股関節", moves: ["femur", ...leg], pivot: hip, axis: unit(sub(ankle, hip)), plus: "外旋" },
  knee: { ja: "膝関節", moves: leg, pivot: knee, axis: kneeAxis, plus: "屈曲" },
  ankle: { ja: "距腿関節", moves: foot, pivot: ankle, axis: ankleAxis, plus: "背屈" },
  // 距骨下関節の軸は踵骨の後ろから距骨頭へ、前・上・内側へ傾いて通る。本当の軸（約40°上向き）で回すと前足が内へ振れる
  // 動き（内転）が目立つので、足の裏が内を向くのが分かるよう足の長軸に近づけている。距骨は動かさない
  subtalar: {
    ja: "距骨下関節", moves: ["calcaneus", "navicular", "cuboid", "cuneiforms", "metatarsals", "phalanges-foot"],
    pivot: pin("head-of-talus"), axis: unit([0.1, 0.15, 1]), plus: "内反",
  },
  hallux: {
    ja: "母趾の中足趾節関節", moves: ["phalanges-foot"], only: greatToe,
    pivot: metatarsalHeads.first, axis: unit([1, 0, 0.15]), plus: "屈曲",
  },
  toes: {
    ja: "第2〜5趾の中足趾節関節", moves: ["phalanges-foot"], only: lesserToes,
    pivot: mid(metatarsalHeads.second, metatarsalHeads.fifth), axis: unit([1, 0.05, 0.35]), plus: "屈曲",
  },
  neck: { ja: "環軸関節", moves: ["atlas", ...skull], pivot: pin("dens-of-axis"), axis: [0, 1, 0], mid: true, plus: "左を向く回旋" },
};
for (const joint of Object.values(joints)) {
  joint.pivot = round(joint.pivot);
  joint.axis = round(joint.axis);
}
fs.writeFileSync(path.join(ROOT, "content/joints.json"), `${JSON.stringify(joints, null, 1).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.replace(/\s+/g, " ")}]`)}\n`);
console.log(`content/joints.json: ${Object.keys(joints).length} 関節`);
